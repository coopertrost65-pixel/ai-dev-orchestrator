import { readPersistedState, writePersistedState } from "@/db/state";
import type { OrchestratorState } from "@/lib/domain/types";
import { syncSecondBrainState } from "@/lib/server/second-brain";

export async function GET() {
  try {
    const payload = await readPersistedState();
    return Response.json({ state: payload ? JSON.parse(payload) : null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "State could not be loaded." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { state?: OrchestratorState };
    if (!body.state || body.state.version !== 1) {
      return Response.json({ error: "A valid version 1 state payload is required." }, { status: 400 });
    }
    await writePersistedState(JSON.stringify(body.state));
    const secondBrain = await syncSecondBrainState(body.state);
    return Response.json({ saved: true, secondBrain });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "State could not be saved." },
      { status: 503 },
    );
  }
}
