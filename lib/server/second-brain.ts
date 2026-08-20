import type { OrchestratorState, Project, Task } from "../domain/types";
import type { MemoryContextItem, SecondBrainStatus } from "../memory/types";

const PRIVATE_FRONTMATTER = /^---\n[\s\S]*?\nprivate:\s*true\s*\n[\s\S]*?\n---/im;
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /1\/\/[0-9A-Za-z_-]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[0-9A-Za-z-]{10,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before", "being", "build", "but", "can", "could", "does", "for", "from", "have", "into", "just", "like", "more", "not", "project", "should", "some", "task", "than", "that", "the", "their", "then", "there", "these", "they", "this", "through", "want", "was", "were", "what", "when", "where", "which", "will", "with", "would", "you", "your",
]);

function memoryRoot(name: "chatgpt" | "claude"): string | null {
  const variable = name === "chatgpt"
    ? process.env.AI_DEV_ORCHESTRATOR_CHATGPT_MEMORY_ROOT
    : process.env.AI_DEV_ORCHESTRATOR_CLAUDE_MEMORY_ROOT;
  return variable?.trim() || null;
}

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[redacted secret]"), value);
}

function cleanLine(value: string, limit = 2_000): string {
  return redactSecrets(value).replace(/\r/g, "").trim().slice(0, limit);
}

function yamlValue(value: string): string {
  return JSON.stringify(cleanLine(value, 500));
}

function projectFileName(projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160);
  return `${safe || "project"}.md`;
}

function markdownList(items: string[], empty = "None recorded."): string {
  const cleaned = items.map((item) => cleanLine(item)).filter(Boolean);
  return cleaned.length ? cleaned.map((item) => `- ${item.replace(/\n+/g, " ")}`).join("\n") : empty;
}

function latestTaskSummary(task: Task): string {
  const handoff = task.handoffs[0];
  return handoff?.summary || task.activity[0]?.detail || "No agent handoff has been recorded yet.";
}

export function renderSecondBrainProject(project: Project, tasks: Task[], syncedAt: string): string {
  const activeCount = tasks.filter((task) => task.status !== "done").length;
  const taskSections = tasks.length ? tasks.map((task) => {
    const permissions = task.permissionRequests ?? [];
    const handoffs = task.handoffs.map((handoff) => [
      `### ${handoff.phase} · ${handoff.agentName}`,
      `- Provider: ${handoff.provider}`,
      `- Outcome: ${handoff.outcome}`,
      `- Decision: ${handoff.decision}`,
      `- Summary: ${cleanLine(handoff.summary)}`,
      `- Next action: ${cleanLine(handoff.nextAction)}`,
      handoff.blockingFindings.length ? `- Blocking findings:\n${markdownList(handoff.blockingFindings)}` : "- Blocking findings: none",
      handoff.disagreement?.status && handoff.disagreement.status !== "none"
        ? `- Disagreement: ${handoff.disagreement.status} — ${cleanLine(handoff.disagreement.summary)}${handoff.disagreement.resolution ? ` — ${cleanLine(handoff.disagreement.resolution)}` : ""}`
        : "- Disagreement: none",
      handoff.evidence.length ? `- Evidence:\n${markdownList(handoff.evidence)}` : "- Evidence: none recorded",
    ].join("\n")).join("\n\n");
    const activity = task.activity.map((item) => `- ${item.createdAt} · ${cleanLine(item.label, 300)} — ${cleanLine(item.detail)}`);
    return [
      `## ${cleanLine(task.title, 500)}`,
      `- Task ID: \`${task.id}\``,
      `- Status: ${task.status}`,
      `- Current phase: ${task.phase}`,
      `- Importance: ${task.importance ?? "important"}`,
      `- Mode: ${task.executionMode ?? "demo"}`,
      `- Updated: ${task.updatedAt}`,
      `- Current summary: ${cleanLine(latestTaskSummary(task))}`,
      `- Request: ${cleanLine(task.brief, 4_000)}`,
      `- Pending approval: ${task.pendingApproval ?? "none"}`,
      "",
      "### Permissions",
      permissions.length ? permissions.map((item) => `- ${item.status} · ${item.action} — ${cleanLine(item.summary)}${item.targets.length ? ` — ${item.targets.map((target) => cleanLine(target, 300)).join(", ")}` : ""}`).join("\n") : "None requested.",
      "",
      "### Activity",
      activity.length ? activity.join("\n") : "No activity recorded yet.",
      "",
      "### Agent handoffs",
      handoffs || "No handoffs recorded yet.",
    ].join("\n");
  }).join("\n\n---\n\n") : "No requests have been created for this project yet.";

  return [
    "---",
    "type: ai-dev-project",
    "source: ai-dev-orchestrator",
    `project_id: ${yamlValue(project.id)}`,
    `status: ${activeCount ? "active" : "complete"}`,
    `updated: ${yamlValue(syncedAt)}`,
    "---",
    "",
    `# ${cleanLine(project.name, 500)}`,
    "",
    cleanLine(project.description, 4_000) || "AI Dev Orchestrator project.",
    "",
    `- Created: ${project.createdAt}`,
    `- Repository: ${project.repositoryPath ? `\`${cleanLine(project.repositoryPath, 1_000)}\`` : "not connected"}`,
    `- Open requests: ${activeCount}`,
    `- Total requests: ${tasks.length}`,
    "",
    "## Shared project documents",
    project.docs.length ? project.docs.map((doc) => `- ${doc.path} — ${cleanLine(doc.description, 500)} — updated ${doc.updatedAt}`).join("\n") : "No project documents recorded.",
    "",
    taskSections,
    "",
    "_Generated automatically by AI Dev Orchestrator. Project-specific source files remain authoritative for code and implementation details._",
    "",
  ].join("\n");
}

export function createSecondBrainFeed(state: OrchestratorState, syncedAt: string) {
  return {
    version: 1,
    source: "ai-dev-orchestrator",
    syncedAt,
    projects: state.projects.map((project) => ({
      id: project.id,
      name: cleanLine(project.name, 500),
      description: cleanLine(project.description, 2_000),
      repositoryPath: project.repositoryPath ? cleanLine(project.repositoryPath, 1_000) : undefined,
      tasks: state.tasks.filter((task) => task.projectId === project.id).map((task) => ({
        id: task.id,
        title: cleanLine(task.title, 500),
        status: task.status,
        phase: task.phase,
        importance: task.importance ?? "important",
        pendingApproval: task.pendingApproval,
        summary: cleanLine(latestTaskSummary(task), 2_000),
        blockers: task.handoffs[0]?.blockingFindings.map((item) => cleanLine(item, 1_000)) ?? [],
        updatedAt: task.updatedAt,
      })),
    })),
  };
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const { mkdir, rename, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const temporary = `${filePath}.${process.pid}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

export async function syncSecondBrainState(state: OrchestratorState, rootOverride?: string): Promise<SecondBrainStatus> {
  const root = rootOverride ?? memoryRoot("chatgpt");
  if (!root) return { connected: false, writable: false, detail: "Second Brain sync is available in the installed Mac app.", projectCount: state.projects.length, taskCount: state.tasks.length };
  const { stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) return { connected: false, writable: false, detail: "ChatGPT Memory was not found. Second Brain sync is paused.", projectCount: state.projects.length, taskCount: state.tasks.length };

  const syncedAt = new Date().toISOString();
  const output = join(root, "AI Dev Orchestrator");
  try {
    const feed = createSecondBrainFeed(state, syncedAt);
    await atomicWrite(join(output, "feed.json"), `${JSON.stringify(feed, null, 2)}\n`);
    await atomicWrite(join(output, "README.md"), [
      "---",
      "type: ai-dev-index",
      "source: ai-dev-orchestrator",
      `updated: ${yamlValue(syncedAt)}`,
      "---",
      "",
      "# AI Dev Orchestrator",
      "",
      "This folder is the structured Second Brain record for software-development work coordinated by AI Dev Orchestrator.",
      "",
      `- Projects: ${state.projects.length}`,
      `- Requests: ${state.tasks.length}`,
      "- Claude Memory remains Claude-owned; this app writes only to the separate ChatGPT Memory source already imported by Second Brain.",
      "- Raw hidden reasoning, credentials, token counts, and usage estimates are not stored here.",
      "",
      "## Projects",
      state.projects.length ? state.projects.map((project) => `- [[AI Dev Orchestrator/Projects/${projectFileName(project.id).replace(/\.md$/, "")}|${cleanLine(project.name, 500)}]]`).join("\n") : "No projects yet.",
      "",
    ].join("\n"));
    await Promise.all(state.projects.map((project) => atomicWrite(
      join(output, "Projects", projectFileName(project.id)),
      renderSecondBrainProject(project, state.tasks.filter((task) => task.projectId === project.id), syncedAt),
    )));
    return { connected: true, writable: true, detail: "Projects, decisions, handoffs, approvals, and results are synced to Second Brain.", lastSyncedAt: syncedAt, projectCount: state.projects.length, taskCount: state.tasks.length };
  } catch (error) {
    return { connected: true, writable: false, detail: error instanceof Error ? `Second Brain is reachable, but sync failed: ${error.message}` : "Second Brain is reachable, but sync failed.", projectCount: state.projects.length, taskCount: state.tasks.length };
  }
}

export async function getSecondBrainStatus(): Promise<SecondBrainStatus> {
  const root = memoryRoot("chatgpt");
  if (!root) return { connected: false, writable: false, detail: "Second Brain sync is available in the installed Mac app.", projectCount: 0, taskCount: 0 };
  const { readFile, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) return { connected: false, writable: false, detail: "ChatGPT Memory was not found. Second Brain sync is paused.", projectCount: 0, taskCount: 0 };
  const feedPath = join(root, "AI Dev Orchestrator", "feed.json");
  try {
    const feed = JSON.parse(await readFile(feedPath, "utf8")) as ReturnType<typeof createSecondBrainFeed>;
    return { connected: true, writable: true, detail: "Projects, decisions, handoffs, approvals, and results are synced to Second Brain.", lastSyncedAt: feed.syncedAt, projectCount: feed.projects.length, taskCount: feed.projects.reduce((total, project) => total + project.tasks.length, 0) };
  } catch {
    return { connected: true, writable: true, detail: "Second Brain is connected. The first Orchestrator save will create its activity feed.", projectCount: 0, taskCount: 0 };
  }
}

function termsFor(value: string): string[] {
  return Array.from(new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []).filter((term) => !STOP_WORDS.has(term)))).slice(0, 80);
}

async function markdownFiles(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (found.length >= 500) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= 500) break;
      if (entry.name.startsWith(".") || entry.name === "Files") continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(fullPath);
    }
  }
  await visit(root);
  return found;
}

function excerptFor(content: string, terms: string[]): string {
  const clean = redactSecrets(content.replace(/^---\n[\s\S]*?\n---\n?/, "")).trim();
  const lower = clean.toLowerCase();
  const hits = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 350);
  return clean.slice(start, start + 2_400).trim();
}

export async function loadRelevantMemoryContext(task: Task, project: Project, rootsOverride?: { claude?: string; chatgpt?: string }): Promise<MemoryContextItem[]> {
  const roots = [
    { root: rootsOverride?.claude ?? memoryRoot("claude"), source: "claude_memory" as const },
    { root: rootsOverride?.chatgpt ?? memoryRoot("chatgpt"), source: "chatgpt_memory" as const },
  ].filter((item): item is { root: string; source: MemoryContextItem["source"] } => Boolean(item.root));
  if (!roots.length) return [];
  const { basename, relative } = await import("node:path");
  const { readFile } = await import("node:fs/promises");
  const query = `${project.name} ${project.description} ${task.title} ${task.brief}`;
  const terms = termsFor(query);
  if (!terms.length) return [];
  const ranked: Array<MemoryContextItem & { score: number }> = [];
  for (const { root, source } of roots) {
    for (const filePath of await markdownFiles(root)) {
      const raw = await readFile(filePath, "utf8").catch(() => "");
      if (!raw || PRIVATE_FRONTMATTER.test(raw)) continue;
      const lowerPath = relative(root, filePath).toLowerCase();
      const lower = raw.toLowerCase().slice(0, 40_000);
      const score = terms.reduce((total, term) => total + (lowerPath.includes(term) ? 8 : 0) + Math.min(4, lower.split(term).length - 1), 0)
        + (lowerPath.includes("ai dev orchestrator") ? 6 : 0)
        + (basename(filePath).toLowerCase() === "profile.md" ? 1 : 0);
      if (score <= 1) continue;
      ranked.push({ source, path: relative(root, filePath), excerpt: excerptFor(raw, terms), score });
    }
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, 5).map((item) => ({ source: item.source, path: item.path, excerpt: item.excerpt }));
}
