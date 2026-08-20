import assert from "node:assert/strict";
import test from "node:test";
import type { AgentConfig, Project, Task, TaskImportance, WorkflowPhase } from "../lib/domain/types.ts";
import type { ProviderRequest } from "../lib/providers/types.ts";
import { selectClaudeModel } from "../lib/server/subscription-providers.ts";

const project: Project = { id: "project-model", name: "Model selection test", description: "", createdAt: "2026-08-20T00:00:00.000Z", docs: [] };
const agent: AgentConfig = { role: "implementer", name: "Implementer", provider: "anthropic", model: "Claude", mandate: "Build" };

function request(phase: WorkflowPhase, importance?: TaskImportance): ProviderRequest {
  const task: Task = {
    id: "task-model", projectId: project.id, title: "t", brief: "b", phase, status: "active",
    round: 0, roundLimit: 12, cost: 0, costLimit: 0, pendingApproval: null, importance,
    handoffs: [], activity: [], createdAt: project.createdAt, updatedAt: project.createdAt,
  };
  return { task, project, agent, phase, toRole: "tester", docs: [], crossModelReview: false };
}

test("read-only phases always use the cheap model, importance aside", () => {
  assert.equal(selectClaudeModel(request("explore", "important")), "haiku");
  assert.equal(selectClaudeModel(request("explore", "standard")), "haiku");
  assert.equal(selectClaudeModel(request("verify", "important")), "haiku");
});

test("a standard task stays on the cheap or default model through the whole pipeline", () => {
  assert.equal(selectClaudeModel(request("plan", "standard")), "haiku");
  assert.equal(selectClaudeModel(request("implement", "standard")), "sonnet");
  assert.equal(selectClaudeModel(request("code_review", "standard")), "sonnet");
});

test("an important task escalates planning, building, and review to the strongest model", () => {
  assert.equal(selectClaudeModel(request("plan", "important")), "sonnet");
  assert.equal(selectClaudeModel(request("implement", "important")), "opus");
  assert.equal(selectClaudeModel(request("fix", "important")), "opus");
  assert.equal(selectClaudeModel(request("code_review", "important")), "opus");
});

test("an unset importance is treated as standard, matching the rest of the app", () => {
  assert.equal(selectClaudeModel(request("implement", undefined)), "sonnet");
});
