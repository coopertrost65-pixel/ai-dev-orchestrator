import { getSecondBrainStatus } from "@/lib/server/second-brain";

export async function GET() {
  try {
    return Response.json(await getSecondBrainStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Second Brain status is unavailable." }, { status: 503 });
  }
}
