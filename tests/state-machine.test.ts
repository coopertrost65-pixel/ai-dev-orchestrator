import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "../lib/domain/types.ts";
import {
  getExecutionBlock,
  phaseAfterApproval,
  phaseAfterExecution,
  WORKFLOW,
} from "../lib/orchestrator/state-machine.ts";

const task: Task = {
  id: "task-test",
  projectId: "project-test",
  title: "Test task",
  brief: "Exercise state transitions",
  phase: "explore",
  status: "active",
  round: 0,
  roundLimit: 8,
  cost: 0,
  costLimit: 2,
  pendingApproval: null,
  handoffs: [],
  activity: [],
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

test("workflow preserves the canonical nine-state order", () => {
  assert.deepEqual(
    WORKFLOW.map((phase) => phase.id),
    ["explore", "plan", "plan_review", "approve", "implement", "verify", "code_review", "fix", "done"],
  );
});

test("plan review stops at the human plan gate", () => {
  assert.deepEqual(phaseAfterExecution("plan_review"), { phase: "approve", gate: "plan" });
  assert.equal(phaseAfterApproval("plan"), "implement");
});

test("code review stops before fixes until findings are accepted", () => {
  assert.deepEqual(phaseAfterExecution("code_review"), { phase: "code_review", gate: "findings" });
  assert.equal(phaseAfterApproval("findings"), "fix");
  assert.equal(phaseAfterApproval("findings", "passed"), "done");
});

test("a fix always returns to fresh verification", () => {
  assert.deepEqual(phaseAfterExecution("fix"), { phase: "verify", gate: null });
});

test("safety stop, approval, and completion conditions block execution", () => {
  assert.equal(getExecutionBlock({ ...task, pendingApproval: "plan" }), "Resolve the approval gate before running another agent.");
  assert.equal(getExecutionBlock({ ...task, round: 8 }), "Safety stop reached after 8 agent steps. Increase it under Advanced controls to continue.");
  assert.equal(getExecutionBlock({ ...task, cost: 2 }), null);
  assert.equal(getExecutionBlock({ ...task, phase: "done", status: "done" }), "This task is already complete.");
});
