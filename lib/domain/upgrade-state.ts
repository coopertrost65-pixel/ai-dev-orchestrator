import { createDefaultDocs, createInitialState } from "./initial-state";
import type { DisagreementRecord, HandoffMessage, OrchestratorState, ProviderId } from "./types";
import { DEFAULT_LOOP_COUNTS, DEFAULT_LOOP_LIMITS } from "../orchestrator/policy";

function providerPosition(provider: ProviderId): string {
  return provider === "openai"
    ? "Prefer the smallest provider-neutral boundary that can be validated now."
    : "Prefer stronger explicit structure now to reduce ambiguity in later agent runs.";
}

function upgradeHandoff(handoff: HandoffMessage, state: OrchestratorState): HandoffMessage {
  const upgraded = {
    ...handoff,
    outcome: handoff.outcome ?? (handoff.phase === "verify" ? "passed" : handoff.phase === "code_review" ? "changes_required" : "informational"),
    blockingFindings: handoff.blockingFindings ?? [],
    documentationUpdates: handoff.documentationUpdates ?? [],
    permissionRequests: handoff.permissionRequests ?? [],
  };
  if (handoff.phase !== "plan_review" && handoff.phase !== "code_review") return upgraded;
  const builderRole = handoff.phase === "plan_review" ? "architect" : "implementer";
  const builderProvider = handoff.builderProvider ?? state.agents.find((agent) => agent.role === builderRole)?.provider;
  const disagreement: DisagreementRecord = handoff.disagreement ?? {
    status: handoff.decision === "proposed" ? "open" : "reconciled",
    summary: "The models disagree on how much structure should be introduced in this pass.",
    arguments: builderProvider
      ? [
          { provider: builderProvider, position: providerPosition(builderProvider) },
          { provider: handoff.provider, position: providerPosition(handoff.provider) },
        ]
      : undefined,
    resolution: handoff.decision === "proposed" ? undefined : "The accepted handoff records the chosen direction.",
  };
  return {
    ...upgraded,
    builderProvider,
    stance: handoff.stance ?? "challenge",
    challenges: handoff.challenges ?? [
      "The previous agent's conclusion is treated as a claim to verify, not a fact.",
      "Any rejected finding must include evidence and a concrete reason.",
    ],
    disagreement,
  };
}

export function upgradeState(state: OrchestratorState): OrchestratorState {
  const defaults = createInitialState();
  const defaultDocs = createDefaultDocs();
  const onlyStarterData = state.projects.length === 1
    && state.projects[0]?.id === "project-orchestrator"
    && state.tasks.every((task) => ["task-handoffs", "task-provider-boundary", "task-docs"].includes(task.id));
  if (onlyStarterData || (state.projects.length === 0 && state.tasks.length === 0)) return defaults;
  return {
    ...state,
    agents: defaults.agents.map((defaultAgent) => {
      const existing = state.agents.find((agent) => agent.role === defaultAgent.role);
      return existing ? { ...defaultAgent, ...existing, mandate: defaultAgent.mandate } : defaultAgent;
    }),
    projects: state.projects.map((project) => ({
      ...project,
      docs: [
        ...project.docs,
        ...defaultDocs
          .filter((defaultDoc) => !project.docs.some((doc) => doc.path === defaultDoc.path))
          .map((doc) => ({ ...doc, id: `${project.id}-${doc.id}` })),
      ],
    })),
    tasks: state.tasks.map((task) => ({
      ...task,
      importance: task.importance ?? (task.status === "done" ? "standard" : "important"),
      executionMode: task.executionMode ?? "demo",
      loopCounts: task.loopCounts ?? { ...DEFAULT_LOOP_COUNTS },
      loopLimits: task.loopLimits ?? { ...DEFAULT_LOOP_LIMITS },
      reconciliationCount: task.reconciliationCount ?? 0,
      reconciliationLimit: task.reconciliationLimit ?? 1,
      permissionRequests: task.permissionRequests ?? [],
      handoffs: task.handoffs.map((handoff) => upgradeHandoff(handoff, state)),
    })),
  };
}
