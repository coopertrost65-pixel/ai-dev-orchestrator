import assert from "node:assert/strict";
import test from "node:test";
import type { AgentConfig, Project, Task } from "../lib/domain/types.ts";
import type { ProviderRequest } from "../lib/providers/types.ts";
import { claudeDisallowedTools } from "../lib/providers/claude-permissions.ts";

const task: Task = {
  id: "task-permission",
  projectId: "project-permission",
  title: "Check permission boundary",
  brief: "Do not widen tool access without approval",
  phase: "implement",
  status: "active",
  round: 0,
  roundLimit: 12,
  cost: 0,
  costLimit: 0,
  pendingApproval: null,
  handoffs: [],
  activity: [],
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};
const project: Project = { id: "project-permission", name: "Permission test", description: "", createdAt: task.createdAt, docs: [] };
const agent: AgentConfig = { role: "implementer", name: "Implementer", provider: "anthropic", model: "Claude", mandate: "Build safely" };

function request(permissionDecisions: ProviderRequest["permissionDecisions"] = []): ProviderRequest {
  return { task, project, agent, phase: "implement", toRole: "tester", docs: [], crossModelReview: false, permissionDecisions };
}

test("risky Claude tools stay blocked until the exact action is approved", () => {
  const blocked = claudeDisallowedTools(request());
  assert.ok(blocked.includes("Bash(npm install *)"));
  assert.ok(blocked.includes("Bash(rm *)"));
  assert.ok(blocked.includes("Bash(git commit *)"));

  const approvedInstall = claudeDisallowedTools(request([{
    id: "permission-install",
    action: "install_packages",
    summary: "Install one approved package",
    command: "npm install example-package",
    targets: ["package.json", "package-lock.json"],
    status: "approved",
    createdAt: task.createdAt,
  }]));
  assert.equal(approvedInstall.includes("Bash(npm install *)"), false);
  assert.ok(approvedInstall.includes("Bash(rm *)"));
  assert.ok(approvedInstall.includes("Bash(git commit *)"));
});
