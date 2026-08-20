import type { ProviderStatusResponse } from "./types";

export interface ProviderRoutingCopy {
  title: string;
  detail: string;
  blocked: boolean;
}

export function providerRoutingCopy(providerStatus: ProviderStatusResponse): ProviderRoutingCopy {
  const connections = [providerStatus.openai, providerStatus.anthropic];
  const connected = connections.filter((connection) => connection.subscriptionAuthenticated);
  const reached = connected.filter((connection) => connection.usage.state === "limit_reached");
  const available = connected.filter((connection) => connection.usage.state !== "limit_reached");

  if (!connected.length) {
    return {
      title: "No subscriptions connected.",
      detail: "Connect Codex or Claude in the installed Mac app. Practice mode still works without either one.",
      blocked: true,
    };
  }
  if (reached.length) {
    return {
      title: available.length ? "One model is currently available." : "Subscription work is paused.",
      detail: available.length
        ? "Ordinary work can continue, but important independent review waits for the other model."
        : "Wait for a provider reset or use Practice mode.",
      blocked: true,
    };
  }
  if (connected.length === 1) {
    return {
      title: "One model is connected.",
      detail: "Ordinary work can run. Important changes wait until the second model is available for independent review.",
      blocked: false,
    };
  }
  return {
    title: "Both models are available.",
    detail: "The second model joins only when an important change needs independent review.",
    blocked: false,
  };
}
