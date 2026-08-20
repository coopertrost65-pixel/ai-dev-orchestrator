import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInitialState } from "../lib/domain/initial-state.ts";
import type { Project, Task } from "../lib/domain/types.ts";
import { loadRelevantMemoryContext, syncSecondBrainState } from "../lib/server/second-brain.ts";

const timestamp = "2026-08-20T12:00:00.000Z";
const project: Project = {
  id: "project-memory",
  name: "AI Dev Orchestrator",
  description: "Coordinate Codex and Claude safely",
  createdAt: timestamp,
  docs: [],
};
const task: Task = {
  id: "task-memory",
  projectId: project.id,
  title: "Connect Second Brain",
  brief: "Sync durable decisions without leaking sk-abcdefghijklmnopqrstuvwxyz012345",
  phase: "plan",
  status: "active",
  importance: "important",
  executionMode: "subscription",
  round: 1,
  roundLimit: 12,
  cost: 0,
  costLimit: 0,
  pendingApproval: null,
  handoffs: [],
  activity: [{ id: "activity-memory", label: "Request created", detail: "Second Brain connection requested", createdAt: timestamp }],
  createdAt: timestamp,
  updatedAt: timestamp,
};

test("Second Brain sync writes structured, secret-redacted project memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-dev-second-brain-"));
  try {
    const state = { ...createInitialState(), projects: [project], tasks: [task], activeProjectId: project.id, activeTaskId: task.id };
    const status = await syncSecondBrainState(state, root);
    assert.equal(status.connected, true);
    assert.equal(status.writable, true);

    const projectNote = await readFile(join(root, "AI Dev Orchestrator", "Projects", `${project.id}.md`), "utf8");
    assert.match(projectNote, /Connect Second Brain/);
    assert.match(projectNote, /Second Brain connection requested/);
    assert.doesNotMatch(projectNote, /sk-abcdefghijklmnopqrstuvwxyz012345/);
    assert.match(projectNote, /\[redacted secret\]/);

    const feed = JSON.parse(await readFile(join(root, "AI Dev Orchestrator", "feed.json"), "utf8")) as { projects: Array<{ tasks: unknown[] }> };
    assert.equal(feed.projects.length, 1);
    assert.equal(feed.projects[0].tasks.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory retrieval is relevant, bounded, and excludes private notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-dev-memory-search-"));
  const claudeRoot = join(root, "Claude Memory");
  const chatgptRoot = join(root, "ChatGPT Memory");
  try {
    await mkdir(join(claudeRoot, "Topics"), { recursive: true });
    await mkdir(chatgptRoot, { recursive: true });
    await writeFile(join(claudeRoot, "Topics", "AI Development.md"), "# AI Development\n\nSecond Brain should preserve cross-model review decisions for the orchestrator.\n", "utf8");
    await writeFile(join(claudeRoot, "Topics", "Private.md"), "---\nprivate: true\n---\n# Secret Orchestrator\nThis private note must never be retrieved.\n", "utf8");
    await writeFile(join(chatgptRoot, "Unrelated.md"), "# Grocery list\n\nMilk and bread.\n", "utf8");

    const context = await loadRelevantMemoryContext(task, project, { claude: claudeRoot, chatgpt: chatgptRoot });
    assert.ok(context.length > 0);
    assert.ok(context.length <= 5);
    assert.ok(context.some((item) => item.path === "Topics/AI Development.md"));
    assert.ok(context.every((item) => item.path !== "Topics/Private.md"));
    assert.ok(context.every((item) => item.path !== "Unrelated.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Second Brain project files cannot escape their dedicated folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-dev-memory-boundary-"));
  try {
    const unsafeProject = { ...project, id: "../../outside" };
    const unsafeTask = { ...task, projectId: unsafeProject.id };
    const state = { ...createInitialState(), projects: [unsafeProject], tasks: [unsafeTask], activeProjectId: unsafeProject.id, activeTaskId: unsafeTask.id };
    const status = await syncSecondBrainState(state, root);
    assert.equal(status.writable, true);
    const note = await readFile(join(root, "AI Dev Orchestrator", "Projects", "______outside.md"), "utf8");
    assert.match(note, /AI Dev Orchestrator/);
    await assert.rejects(readFile(join(root, "outside.md"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
