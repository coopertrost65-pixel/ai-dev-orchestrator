import type { AgentConfig, OrchestratorState, ProjectDoc } from "./types";

const agents: AgentConfig[] = [
  {
    role: "architect",
    name: "Architect",
    provider: "anthropic",
    model: "Claude-style planner",
    mandate: "Explore the repo, surface constraints, and propose the smallest safe plan.",
  },
  {
    role: "implementer",
    name: "Implementer",
    provider: "openai",
    model: "Codex-style builder",
    mandate: "Implement the approved plan without widening scope or bypassing gates.",
  },
  {
    role: "reviewer",
    name: "Reviewer",
    provider: "anthropic",
    model: "Claude-style default reviewer",
    mandate: "Use the provider opposite the builder, assume the builder may be wrong, and challenge claims with evidence.",
  },
  {
    role: "tester",
    name: "Tester",
    provider: "openai",
    model: "Codex-style verifier",
    mandate: "Run proportional checks and report exact evidence, failures, and coverage gaps.",
  },
];

export function createDefaultDocs(timestamp = new Date().toISOString()): ProjectDoc[] {
  return [
    {
      id: "doc-agents",
      path: "AGENTS.md",
      title: "Codex instructions",
      description: "Persistent working rules for OpenAI/Codex-style agents.",
      content: "Read docs/AI_DEV_PROTOCOL.md before changing code. Respect approval gates, safety stop rules, and the assigned role. Record evidence in every handoff.",
      updatedAt: timestamp,
    },
    {
      id: "doc-claude",
      path: "CLAUDE.md",
      title: "Claude instructions",
      description: "Persistent working rules for Anthropic/Claude-style agents.",
      content: "Follow docs/AI_DEV_PROTOCOL.md. Do not implement an unapproved plan. Treat project docs and the latest structured handoff as the source of truth.",
      updatedAt: timestamp,
    },
    {
      id: "doc-protocol",
      path: "docs/AI_DEV_PROTOCOL.md",
      title: "Development protocol",
      description: "The canonical workflow, gate policy, and handoff contract.",
      content: "Explore → Plan → Review → Approve → Implement → Verify → Review → Fix → Verify → Review → Done\n\nEvery phase produces a structured handoff. Human approval is required before implementation and after review. A fix always returns to fresh verification and independent review.",
      updatedAt: timestamp,
    },
    {
      id: "doc-core-requirements",
      path: "docs/CORE_REQUIREMENTS.md",
      title: "Core control requirements",
      description: "Cross-model review, permissions, modes, finite loops, tools, and definition of done.",
      content: "Cross-model review is mandatory for important changes. Reviewers challenge the builder, disagreements preserve both positions, risky actions require approval, loops are finite, no task is done without verification and independent review, and structured activity syncs into Second Brain.",
      updatedAt: timestamp,
    },
    {
      id: "doc-product",
      path: "docs/PRODUCT.md",
      title: "Product brief",
      description: "Who the product serves and what v1 must accomplish.",
      content: "AI Dev Orchestrator is a local-first command center for coordinating complementary AI development agents with explicit responsibilities, shared context, and auditable decisions.",
      updatedAt: timestamp,
    },
    {
      id: "doc-architecture",
      path: "docs/ARCHITECTURE.md",
      title: "Architecture",
      description: "System boundaries, data shape, and provider integration seams.",
      content: "The UI calls a provider-neutral orchestration core. Practice adapters call no model. Desktop-only subscription adapters invoke locally installed Codex or Claude Code after confirming subscription authentication and exact project-folder access. API-key fallback is prohibited. Desktop saves publish a secret-redacted project record to ChatGPT Memory for Second Brain, while Claude Memory remains read-only.",
      updatedAt: timestamp,
    },
    {
      id: "doc-decisions",
      path: "docs/DECISIONS.md",
      title: "Decision log",
      description: "Durable decisions and the reasons behind them.",
      content: "ADR-001: Use a deterministic state machine.\nADR-002: Default to no-model Practice mode.\nADR-003: Require human approval before implementation.\nADR-004: Subscription mode never uses API-key billing.\nADR-005: Authorize one exact local Git project folder.\nADR-006: A fix must pass fresh verification and independent review before Done.\nADR-007: Reconciliation is one real bounded provider call.\nADR-008: Risky actions stop for an exact recorded permission decision.\nADR-009: Sync structured activity through ChatGPT Memory into Second Brain without writing Claude Memory.",
      updatedAt: timestamp,
    },
  ];
}

export function createInitialState(): OrchestratorState {
  return {
    version: 1,
    activeProjectId: "",
    activeTaskId: "",
    agents,
    projects: [],
    tasks: [],
  };
}
