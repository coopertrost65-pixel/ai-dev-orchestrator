import assert from "node:assert/strict";
import test from "node:test";
import { providerRoutingCopy } from "../lib/providers/routing.ts";
import type { ProviderConnection, ProviderStatusResponse } from "../lib/providers/types.ts";

function connection(provider: "openai" | "anthropic", authenticated: boolean, state: ProviderConnection["usage"]["state"] = "unknown"): ProviderConnection {
  return {
    provider,
    available: authenticated,
    subscriptionAuthenticated: authenticated,
    label: provider === "openai" ? "Codex" : "Claude",
    detail: "",
    usage: { state, summary: "", windows: [], checkedAt: "2026-08-20T00:00:00.000Z", source: "unavailable" },
  };
}

function status(openai: ProviderConnection, anthropic: ProviderConnection): ProviderStatusResponse {
  return { desktop: true, openai, anthropic };
}

test("routing copy never calls disconnected subscriptions available", () => {
  const none = providerRoutingCopy(status(connection("openai", false), connection("anthropic", false)));
  assert.equal(none.title, "No subscriptions connected.");
  const one = providerRoutingCopy(status(connection("openai", true, "available"), connection("anthropic", false)));
  assert.equal(one.title, "One model is connected.");
  const both = providerRoutingCopy(status(connection("openai", true, "available"), connection("anthropic", true, "available")));
  assert.equal(both.title, "Both models are available.");
});
