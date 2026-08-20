import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "./types";

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly id = "anthropic" as const;
  readonly label = "Claude · subscription";
  readonly mode = "subscription" as const;

  private readonly endpoint: string;

  constructor(endpoint = "/api/providers/anthropic") {
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
      throw new Error(payload?.error ?? "Claude subscription connection is unavailable.");
    }
    return response.json() as Promise<ProviderResponse>;
  }
}
