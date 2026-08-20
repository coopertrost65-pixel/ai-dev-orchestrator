import assert from "node:assert/strict";
import test from "node:test";
import type { AgentConfig, Project, Task } from "../lib/domain/types.ts";
import { MockProviderAdapter } from "../lib/providers/mock.ts";

const task: Task = {
  id: "task-test",
  projectId: "project-test",
  title: "Normalize a response",
  brief: "Return the shared provider shape",
  phase: "plan",
  status: "active",
  round: 1,
  roundLimit: 8,
  cost: 0.04,
  costLimit: 2,
  pendingApproval: null,
  handoffs: [],
  activity: [],
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

const agent: AgentConfig = {
  role: "architect",
  name: "Architect",
  provider: "openai",
  model: "Mock planner",
  mandate: "Plan safely",
};

const project: Project = {
  id: "project-test",
  name: "Test project",
  description: "Provider adapter tests",
  createdAt: "2026-08-19T00:00:00.000Z",
  docs: [],
};

test("mock providers return structured practice handoffs", async () => {
  const provider = new MockProviderAdapter("openai", 0);
  const response = await provider.run({ task, project, phase: "plan", agent, toRole: "reviewer", docs: [], crossModelReview: false });

  assert.equal(provider.mode, "mock");
  assert.match(response.summary, /plan/i);
  assert.ok(response.details.length > 0);
  assert.ok(response.evidence.length > 0);
  assert.ok(response.nextAction.length > 0);
  assert.equal(response.outcome, "informational");
  assert.ok(response.documentationUpdates.length > 0);
  assert.equal(response.usage.inputTokens, 0);
  assert.equal(response.usage.estimatedCost, 0);
});

test("mock reviewers challenge claims and preserve disagreement", async () => {
  const reviewer: AgentConfig = { ...agent, role: "reviewer", name: "Reviewer", provider: "anthropic" };
  const provider = new MockProviderAdapter("anthropic", 0);
  const response = await provider.run({
    task: { ...task, phase: "plan_review", importance: "important" },
    project,
    phase: "plan_review",
    agent: reviewer,
    toRole: "human",
    docs: [],
    builderProvider: "openai",
    crossModelReview: true,
  });

  assert.equal(response.stance, "challenge");
  assert.ok(response.challenges && response.challenges.length > 0);
  assert.equal(response.disagreement?.status, "open");
  assert.deepEqual(response.disagreement?.arguments?.map((item) => item.provider), ["openai", "anthropic"]);
});

test("mock reconciliation performs a bounded provider step", async () => {
  const provider = new MockProviderAdapter("openai", 0);
  const response = await provider.run({
    task,
    project,
    phase: "plan_review",
    agent: { ...agent, role: "reviewer" },
    toRole: "human",
    docs: [],
    crossModelReview: true,
    reconciliation: {
      status: "open",
      summary: "Two valid approaches differ.",
      arguments: [
        { provider: "openai", position: "Keep the boundary small." },
        { provider: "anthropic", position: "Add the safety contract now." },
      ],
    },
  });
  assert.equal(response.disagreement?.status, "reconciled");
  assert.match(response.summary, /reconsidered/i);
});
