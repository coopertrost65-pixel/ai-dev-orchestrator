import type {
  AgentConfig,
  DefinitionOfDoneChecks,
  HandoffMessage,
  LoopBudget,
  LoopKind,
  OperatingMode,
  ProviderId,
  Task,
  WorkflowPhase,
} from "../domain/types";

export const DEFAULT_LOOP_LIMITS: LoopBudget = { planning: 2, review: 2, fix: 2 };
export const DEFAULT_LOOP_COUNTS: LoopBudget = { planning: 0, review: 0, fix: 0 };

export const OPERATING_MODES: ReadonlyArray<{ id: OperatingMode; label: string; purpose: string }> = [
  { id: "plan", label: "Plan", purpose: "Explore context, design the approach, and challenge it before approval." },
  { id: "build", label: "Build", purpose: "Make only the changes allowed by the approved plan." },
  { id: "review", label: "Review", purpose: "Verify evidence and perform independent cross-model review." },
  { id: "debug", label: "Debug", purpose: "Resolve accepted findings with bounded fix loops." },
  { id: "ship", label: "Ship", purpose: "Confirm the definition of done and request deployment approval." },
] as const;

export const PERMISSION_RULES = [
  { action: "Read files and search code", level: "automatic", detail: "Allowed in every mode." },
  { action: "Run tests and inspect git diff", level: "automatic", detail: "Allowed when commands are read-only." },
  { action: "Edit code", level: "mode_gated", detail: "Allowed only in Build or Debug after plan approval." },
  { action: "Install packages", level: "approval_required", detail: "Always pauses for user approval." },
  { action: "Apply database migrations", level: "approval_required", detail: "Always pauses for user approval." },
  { action: "Delete files or data", level: "approval_required", detail: "Exact targets must be shown first." },
  { action: "Create branches or commits", level: "approval_required", detail: "Requires explicit repository authority." },
  { action: "Deploy to production", level: "approval_required", detail: "Always requires explicit approval." },
  { action: "Modify secrets", level: "manual_only", detail: "Agents may identify the need; they never modify secrets automatically." },
] as const;

export const REPOSITORY_TOOL_ROADMAP = [
  { tool: "Read files", status: "core", permission: "Automatic" },
  { tool: "Search code", status: "core", permission: "Automatic" },
  { tool: "Edit code", status: "core", permission: "Mode-gated" },
  { tool: "Run commands", status: "core", permission: "Risk-dependent" },
  { tool: "Run tests", status: "core", permission: "Automatic" },
  { tool: "Git diff", status: "core", permission: "Automatic" },
  { tool: "Branches / commits", status: "core", permission: "Approval" },
  { tool: "Pull requests", status: "later", permission: "Approval" },
] as const;

export const CORE_REQUIREMENTS = [
  { id: "cross-model", label: "Cross-model review", status: "enforced", detail: "Important work is reviewed by the provider that did not build it." },
  { id: "challenge", label: "Adversarial posture", status: "enforced", detail: "Reviewers must test claims and may reject them with reasons." },
  { id: "disagreement", label: "Disagreement handling", status: "enforced", detail: "Both positions are preserved; one bounded reconciliation is available." },
  { id: "permissions", label: "Permission policy", status: "modeled", detail: "The policy is locked; enforcement wraps repository tools as they connect." },
  { id: "modes", label: "Operating modes", status: "enforced", detail: "Every workflow state resolves to Plan, Build, Review, Debug, or Ship." },
  { id: "finite-loops", label: "Finite loops", status: "enforced", detail: "Planning, review, and fix retries each have their own ceiling." },
  { id: "repo-tools", label: "Repository tools", status: "core-roadmap", detail: "Read, search, edit, commands, tests, diff, branches, commits, then PRs." },
  { id: "routing", label: "Purposeful model routing", status: "enforced", detail: "One model works; the other joins when independent review adds value." },
  { id: "shared-brain", label: "Project as shared brain", status: "enforced", detail: "Discoveries and decisions belong in durable project docs." },
  { id: "done", label: "Strict definition of done", status: "enforced", detail: "Verification, independent review, approvals, and resolved disagreement are required." },
  { id: "second-brain", label: "Second Brain continuity", status: "enforced", detail: "Structured project activity syncs to shared memory, and real agents retrieve only relevant context." },
] as const;

export function oppositeProvider(provider: ProviderId): ProviderId {
  return provider === "openai" ? "anthropic" : "openai";
}

export function getOperatingMode(phase: WorkflowPhase): OperatingMode {
  if (["explore", "plan", "plan_review", "approve"].includes(phase)) return "plan";
  if (phase === "implement") return "build";
  if (phase === "verify" || phase === "code_review") return "review";
  if (phase === "fix") return "debug";
  return "ship";
}

export function getLoopKind(phase: WorkflowPhase): LoopKind | null {
  if (phase === "plan" || phase === "plan_review") return "planning";
  if (phase === "code_review") return "review";
  if (phase === "fix") return "fix";
  return null;
}

export function getBuilderProviderForReview(phase: WorkflowPhase, agents: AgentConfig[], task?: Task): ProviderId | null {
  const builderRole = phase === "plan_review" ? "architect" : phase === "code_review" ? "implementer" : null;
  if (!builderRole) return null;
  const recordedBuilder = phase === "plan_review"
    ? task?.handoffs.find((handoff) => handoff.phase === "plan")?.provider
    : task?.handoffs.find((handoff) => handoff.phase === "fix" || handoff.phase === "implement")?.provider;
  return recordedBuilder ?? agents.find((agent) => agent.role === builderRole)?.provider ?? null;
}

export function resolveAgentForPhase(phase: WorkflowPhase, agents: AgentConfig[], task?: Task): AgentConfig | null {
  const role = phase === "explore" || phase === "plan"
    ? "architect"
    : phase === "plan_review" || phase === "code_review"
      ? "reviewer"
      : phase === "implement" || phase === "fix"
        ? "implementer"
        : phase === "verify"
          ? "tester"
          : null;
  if (!role) return null;
  const agent = agents.find((item) => item.role === role);
  if (!agent) return null;
  const important = (task?.importance ?? "important") === "important";
  const builderProvider = getBuilderProviderForReview(phase, agents, task);
  if (role === "reviewer" && important && builderProvider) {
    return { ...agent, provider: oppositeProvider(builderProvider), model: "Automatic cross-model reviewer" };
  }
  return agent;
}

export function getLoopBlock(task: Task): string | null {
  const kind = getLoopKind(task.phase);
  if (!kind) return null;
  const counts = task.loopCounts ?? DEFAULT_LOOP_COUNTS;
  const limits = task.loopLimits ?? DEFAULT_LOOP_LIMITS;
  if (counts[kind] >= limits[kind]) {
    return `${kind[0].toUpperCase()}${kind.slice(1)} loop limit reached (${limits[kind]}).`;
  }
  return null;
}

export function evaluateDefinitionOfDone(task: Task, pending?: HandoffMessage): DefinitionOfDoneChecks {
  const handoffs = pending ? [pending, ...task.handoffs] : task.handoffs;
  const important = (task.importance ?? "important") === "important";
  const latestFixIndex = handoffs.findIndex((handoff) => handoff.phase === "fix");
  const verificationIndex = handoffs.findIndex((handoff) => handoff.phase === "verify");
  const reviewIndex = handoffs.findIndex((handoff) => handoff.phase === "code_review");
  const verification = verificationIndex >= 0 ? handoffs[verificationIndex] : undefined;
  const review = reviewIndex >= 0 ? handoffs[reviewIndex] : undefined;
  const verificationIsFresh = Boolean(
    verification
    && verification.outcome === "passed"
    && verification.evidence.length > 0
    && verification.blockingFindings.length === 0
    && (latestFixIndex < 0 || verificationIndex < latestFixIndex),
  );
  const reviewIsFresh = Boolean(review && review.outcome === "passed" && review.blockingFindings.length === 0 && reviewIndex < verificationIndex);
  return {
    verificationPassed: verificationIsFresh,
    independentReviewPassed: Boolean(
      reviewIsFresh && review && (!important || (review.builderProvider && review.builderProvider !== review.provider)),
    ),
    approvalsCleared:
      handoffs.some((handoff) => handoff.phase === "plan_review" && handoff.decision === "accepted") &&
      Boolean(review && review.decision === "accepted"),
    noOpenDisagreement: handoffs.every((handoff) => handoff.disagreement?.status !== "open"),
  };
}

export function allDoneChecksPass(checks: DefinitionOfDoneChecks): boolean {
  return Object.values(checks).every(Boolean);
}
