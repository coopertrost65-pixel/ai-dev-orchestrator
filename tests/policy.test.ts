import assert from "node:assert/strict";
import test from "node:test";
import type { AgentConfig, HandoffMessage, Task } from "../lib/domain/types.ts";
import {
  allDoneChecksPass,
  evaluateDefinitionOfDone,
  getOperatingMode,
  resolveAgentForPhase,
} from "../lib/orchestrator/policy.ts";
import { getExecutionBlock } from "../lib/orchestrator/state-machine.ts";

const agents: AgentConfig[] = [
  { role: "architect", name: "Architect", provider: "openai", model: "Mock", mandate: "Plan" },
  { role: "implementer", name: "Implementer", provider: "anthropic", model: "Mock", mandate: "Build" },
  { role: "reviewer", name: "Reviewer", provider: "anthropic", model: "Mock", mandate: "Challenge" },
  { role: "tester", name: "Tester", provider: "openai", model: "Mock", mandate: "Verify" },
];

const task: Task = {
  id: "task-policy",
  projectId: "project-test",
  title: "Enforce policy",
  brief: "Exercise cross-model routing and completion checks",
  phase: "plan_review",
  status: "active",
  importance: "important",
  round: 0,
  roundLimit: 8,
  cost: 0,
  costLimit: 2,
  pendingApproval: null,
  loopCounts: { planning: 0, review: 0, fix: 0 },
  loopLimits: { planning: 2, review: 2, fix: 2 },
  reconciliationCount: 0,
  reconciliationLimit: 1,
  handoffs: [],
  activity: [],
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

function handoff(patch: Partial<HandoffMessage>): HandoffMessage {
  return {
    id: `handoff-${patch.phase ?? "test"}`,
    phase: "verify",
    fromRole: "tester",
    toRole: "reviewer",
    provider: "openai",
    agentName: "Tester",
    summary: "Evidence recorded",
    details: ["Result"],
    evidence: ["Checks passed"],
    risks: [],
    outcome: "passed",
    blockingFindings: [],
    documentationUpdates: [],
    permissionRequests: [],
    nextAction: "Continue",
    decision: "accepted",
    createdAt: "2026-08-19T00:00:00.000Z",
    estimatedCost: 0.01,
    tokens: 100,
    ...patch,
  };
}

test("workflow states resolve to the five operating modes", () => {
  assert.equal(getOperatingMode("explore"), "plan");
  assert.equal(getOperatingMode("implement"), "build");
  assert.equal(getOperatingMode("code_review"), "review");
  assert.equal(getOperatingMode("fix"), "debug");
  assert.equal(getOperatingMode("done"), "ship");
});

test("important reviews use the provider opposite the builder", () => {
  assert.equal(resolveAgentForPhase("plan_review", agents, task)?.provider, "anthropic");
  assert.equal(resolveAgentForPhase("code_review", agents, task)?.provider, "openai");
  assert.equal(resolveAgentForPhase("code_review", agents, { ...task, importance: "standard" })?.provider, "anthropic");
});

test("important review follows the provider that actually completed the build phase", () => {
  const routedTask: Task = {
    ...task,
    handoffs: [handoff({ phase: "plan", fromRole: "architect", toRole: "reviewer", provider: "anthropic" })],
  };
  assert.equal(resolveAgentForPhase("plan_review", agents, routedTask)?.provider, "openai");
});

test("finite loop ceilings block another agent run", () => {
  const blocked = { ...task, phase: "plan_review" as const, loopCounts: { planning: 2, review: 0, fix: 0 } };
  assert.equal(getExecutionBlock(blocked), "Planning loop limit reached (2).");
});

test("done requires verification, independent review, approvals, and resolved disagreement", () => {
  const completeTask: Task = {
    ...task,
    phase: "code_review",
    handoffs: [
      handoff({ phase: "code_review", fromRole: "reviewer", toRole: "human", provider: "openai", builderProvider: "anthropic", disagreement: { status: "reconciled", summary: "Resolved", resolution: "Accepted" } }),
      handoff({ phase: "verify" }),
      handoff({ phase: "fix", fromRole: "implementer", provider: "anthropic", outcome: "informational" }),
      handoff({ phase: "code_review", fromRole: "reviewer", toRole: "human", provider: "openai", builderProvider: "anthropic", outcome: "changes_required", blockingFindings: ["Fix required"] }),
      handoff({ phase: "verify" }),
      handoff({ phase: "plan_review", fromRole: "reviewer", toRole: "human", provider: "anthropic", builderProvider: "openai" }),
    ],
  };
  const checks = evaluateDefinitionOfDone(completeTask);
  assert.deepEqual(checks, {
    verificationPassed: true,
    independentReviewPassed: true,
    approvalsCleared: true,
    noOpenDisagreement: true,
  });
  assert.equal(allDoneChecksPass(checks), true);
  assert.equal(
    allDoneChecksPass(evaluateDefinitionOfDone({ ...completeTask, handoffs: completeTask.handoffs.map((item, index) => index === 0 ? { ...item, provider: "anthropic" } : item) })),
    false,
  );
  const staleAfterFix = { ...completeTask, handoffs: completeTask.handoffs.slice(2) };
  assert.equal(evaluateDefinitionOfDone(staleAfterFix).verificationPassed, false);
  assert.equal(evaluateDefinitionOfDone({ ...completeTask, handoffs: completeTask.handoffs.map((item, index) => index === 1 ? { ...item, outcome: "changes_required" as const } : item) }).verificationPassed, false);
});
