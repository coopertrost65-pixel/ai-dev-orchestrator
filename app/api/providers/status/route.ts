import { getProviderStatus } from "@/lib/server/subscription-providers";

export async function GET() {
  try {
    return Response.json(await getProviderStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Provider status is unavailable." }, { status: 503 });
  }
}
