import { runCodexSubscription } from "@/lib/server/subscription-providers";
import { loadRelevantMemoryContext } from "@/lib/server/second-brain";
import type { ProviderRequest } from "@/lib/providers/types";

export async function POST(request: Request) {
  try {
    const body = await request.json() as ProviderRequest;
    if (!body?.task || !body?.project || body.agent?.provider !== "openai") {
      return Response.json({ error: "A valid Codex handoff request is required." }, { status: 400 });
    }
    const memoryContext = await loadRelevantMemoryContext(body.task, body.project);
    return Response.json(await runCodexSubscription({ ...body, memoryContext }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Codex could not complete this phase." }, { status: 503 });
  }
}
