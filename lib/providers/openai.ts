import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "./types";

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly id = "openai" as const;
  readonly label = "Codex · ChatGPT subscription";
  readonly mode = "subscription" as const;

  private readonly endpoint: string;

  constructor(endpoint = "/api/providers/openai") {
    this.endpoint = endpoint;
  }

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? "Codex subscription connection is unavailable.");
    }
    return response.json() as Promise<ProviderResponse>;
  }
}
