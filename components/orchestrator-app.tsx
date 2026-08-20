"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { PolicyView } from "@/components/policy-view";
import { createDefaultDocs, createInitialState } from "@/lib/domain/initial-state";
import { upgradeState } from "@/lib/domain/upgrade-state";
import type {
  AgentRole,
  ExecutionMode,
  HandoffMessage,
  OrchestratorState,
  PermissionRequest,
  ProviderId,
  Task,
} from "@/lib/domain/types";
import type { SecondBrainStatus } from "@/lib/memory/types";
import { appendDocumentationUpdates } from "@/lib/orchestrator/docs";
import {
  getExecutionBlock,
  getNextPhase,
  getPhaseDefinition,
  getPhaseIndex,
  phaseAfterApproval,
  phaseAfterExecution,
  progressPercent,
  WORKFLOW,
} from "@/lib/orchestrator/state-machine";
import {
  allDoneChecksPass,
  DEFAULT_LOOP_COUNTS,
  DEFAULT_LOOP_LIMITS,
  evaluateDefinitionOfDone,
  getBuilderProviderForReview,
  getLoopKind,
  getOperatingMode,
  oppositeProvider,
  resolveAgentForPhase,
} from "@/lib/orchestrator/policy";
import { mockProviders } from "@/lib/providers/mock";
import { OpenAIProviderAdapter } from "@/lib/providers/openai";
import { AnthropicProviderAdapter } from "@/lib/providers/anthropic";
import { providerRoutingCopy } from "@/lib/providers/routing";
import type { ProviderAdapter, ProviderConnection, ProviderStatusResponse } from "@/lib/providers/types";

type View = "run" | "tasks" | "docs" | "usage" | "settings" | "agents" | "policy";
type Modal = "project" | "task" | "settings" | null;
type StorageStatus = "loading" | "saved" | "local" | "error";

declare global {
  interface Window {
    aiDevOrchestrator?: {
      selectProjectFolder: () => Promise<string | null>;
    };
  }
}

const subscriptionProviders: Record<ProviderId, ProviderAdapter> = {
  openai: new OpenAIProviderAdapter(),
  anthropic: new AnthropicProviderAdapter(),
};

const disconnectedProviderStatus: ProviderStatusResponse = {
  desktop: false,
  openai: { provider: "openai", available: false, subscriptionAuthenticated: false, label: "Codex", detail: "Checking Codex…", usage: { state: "unknown", summary: "Checking usage…", windows: [], checkedAt: new Date(0).toISOString(), source: "unavailable" } },
  anthropic: { provider: "anthropic", available: false, subscriptionAuthenticated: false, label: "Claude", detail: "Checking Claude…", usage: { state: "unknown", summary: "Checking usage…", windows: [], checkedAt: new Date(0).toISOString(), source: "unavailable" } },
};

const disconnectedSecondBrainStatus: SecondBrainStatus = {
  connected: false,
  writable: false,
  detail: "Checking Second Brain…",
  projectCount: 0,
  taskCount: 0,
};

const providerNames: Record<ProviderId, string> = {
  openai: "OpenAI / Codex",
  anthropic: "Anthropic / Claude",
};

const roleDescriptions: Record<AgentRole, string> = {
  architect: "Explores context and proposes the plan",
  implementer: "Builds only what the approved plan allows",
  reviewer: "Challenges plans and implementation evidence",
  tester: "Verifies behavior and reports exact results",
};

const roleRecommendations: Record<AgentRole, string> = {
  architect: "Recommended · Claude",
  implementer: "Recommended · Codex",
  reviewer: "Important work · automatic opposite AI",
  tester: "Recommended · Codex",
};

function agentModelLabel(role: AgentRole, provider: ProviderId): string {
  const providerLabel = provider === "openai" ? "Codex-style" : "Claude-style";
  const jobLabel: Record<AgentRole, string> = {
    architect: "planner",
    implementer: "builder",
    reviewer: "default reviewer",
    tester: "verifier",
  };
  return `${providerLabel} ${jobLabel[role]}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function taskTitleFromBrief(brief: string): string {
  const firstLine = brief.split(/\n|[.!?]\s/)[0]?.replace(/^[#>*\-\d.)\s]+/, "").trim() ?? "";
  return (firstLine || "New build request").slice(0, 100);
}

function roleInitials(role: AgentRole | "human" | "system"): string {
  if (role === "human") return "YOU";
  if (role === "system") return "SYS";
  return role.slice(0, 2).toUpperCase();
}

function quickUsageLabel(connection: ProviderConnection): string {
  if (!connection.subscriptionAuthenticated) return "Not connected";
  if (connection.usage.state === "limit_reached") return "Limit reached";
  if (connection.usage.state === "near_limit") return "Near limit";
  const mostUsed = connection.usage.windows.reduce<number | null>((current, window) => (
    typeof window.usedPercent === "number" && (current === null || window.usedPercent > current) ? window.usedPercent : current
  ), null);
  if (mostUsed !== null) return `${100 - mostUsed}% left`;
  if (connection.usage.state === "available") return "Allowed";
  return connection.provider === "anthropic" ? "Check usage" : "Ready";
}

export function OrchestratorApp() {
  const [state, setState] = useState<OrchestratorState>(() => createInitialState());
  const [view, setView] = useState<View>("run");
  const [modal, setModal] = useState<Modal>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState("doc-protocol");
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse>(disconnectedProviderStatus);
  const [secondBrainStatus, setSecondBrainStatus] = useState<SecondBrainStatus>(disconnectedSecondBrainStatus);
  const [refreshingProviders, setRefreshingProviders] = useState(false);
  const [showLaunchIntro, setShowLaunchIntro] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0];
  const projectTasks = useMemo(
    () => state.tasks.filter((task) => task.projectId === activeProject?.id),
    [activeProject?.id, state.tasks],
  );
  const activeTask = projectTasks.find((task) => task.id === state.activeTaskId) ?? projectTasks[0];
  const activeDoc = activeProject?.docs.find((doc) => doc.id === activeDocId) ?? activeProject?.docs[0];

  useEffect(() => {
    const timer = window.setTimeout(() => setShowLaunchIntro(false), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/state")
      .then(async (response) => {
        if (!response.ok) throw new Error("Persistent storage is unavailable.");
        return response.json() as Promise<{ state: OrchestratorState | null }>;
      })
      .then(({ state: persistedState }) => {
        if (cancelled) return;
        if (persistedState?.version === 1) setState(upgradeState(persistedState));
        setStorageStatus("saved");
      })
      .catch(() => {
        if (!cancelled) setStorageStatus("local");
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshProviderStatus = useCallback(async () => {
    setRefreshingProviders(true);
    try {
      const response = await fetch("/api/providers/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Provider status is unavailable.");
      setProviderStatus(await response.json() as ProviderStatusResponse);
    } finally {
      setRefreshingProviders(false);
    }
  }, []);

  const refreshSecondBrainStatus = useCallback(async () => {
    const response = await fetch("/api/memory/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Second Brain status is unavailable.");
    setSecondBrainStatus(await response.json() as SecondBrainStatus);
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refreshProviderStatus().catch(() => undefined), 0);
    const memoryTimer = window.setTimeout(() => void refreshSecondBrainStatus().catch(() => undefined), 0);
    const refreshTimer = window.setInterval(() => void refreshProviderStatus().catch(() => undefined), 5 * 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(memoryTimer);
      window.clearInterval(refreshTimer);
    };
  }, [refreshProviderStatus, refreshSecondBrainStatus]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Save failed");
          const result = await response.json() as { secondBrain?: SecondBrainStatus };
          if (result.secondBrain) setSecondBrainStatus(result.secondBrain);
          setStorageStatus("saved");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setStorageStatus("error");
        });
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [hydrated, state]);

  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]";
    window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus(), 0);
    const manageDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", manageDialogKeys);
    return () => {
      window.removeEventListener("keydown", manageDialogKeys);
      previousFocus?.focus();
    };
  }, [modal]);

  function updateTask(taskId: string, updater: (task: Task) => Task) {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  }

  function selectProject(projectId: string) {
    const firstTask = state.tasks.find((task) => task.projectId === projectId);
    setState((current) => ({ ...current, activeProjectId: projectId, activeTaskId: firstTask?.id ?? "" }));
    setActiveDocId(state.projects.find((project) => project.id === projectId)?.docs[0]?.id ?? "");
    setView(firstTask ? "run" : "tasks");
  }

  function selectTask(taskId: string) {
    setState((current) => ({ ...current, activeTaskId: taskId }));
    setView("run");
  }

  async function runNextPhase() {
    if (!activeTask || !activeProject) return;
    const blocked = getExecutionBlock(activeTask);
    if (blocked) {
      setNotice(blocked);
      return;
    }
    const phase = activeTask.phase;
    const definition = getPhaseDefinition(phase);
    if (definition.role === "human" || definition.role === "system") return;
    let agent = resolveAgentForPhase(phase, state.agents, activeTask);
    if (!agent) {
      setNotice(`No ${definition.role} agent is configured.`);
      return;
    }

    const mode = activeTask.executionMode ?? "demo";
    let reroutedFrom: ProviderId | null = null;
    if (mode === "subscription" && providerStatus[agent.provider].usage.state === "limit_reached") {
      const independentReviewRequired = activeTask.importance !== "standard" && ["plan_review", "code_review"].includes(phase);
      const alternate = oppositeProvider(agent.provider);
      if (independentReviewRequired) {
        const reset = providerStatus[agent.provider].usage.summary;
        setNotice(`${providerNames[agent.provider]} is required for the independent second opinion, but its usage limit is reached. ${reset} The app will not let one model review its own work.`);
        return;
      }
      if (providerStatus[alternate].subscriptionAuthenticated && providerStatus[alternate].usage.state !== "limit_reached") {
        reroutedFrom = agent.provider;
        agent = { ...agent, provider: alternate, model: "Automatic available-provider routing" };
      } else {
        setNotice(`${providerNames[agent.provider]} has reached its usage limit, and the other subscription is not currently available. ${providerStatus[agent.provider].usage.summary}`);
        return;
      }
    }

    const transition = phaseAfterExecution(phase);
    const nextDefinition = getPhaseDefinition(transition.phase);
    const toRole = transition.gate ? "human" : nextDefinition.role === "human" || nextDefinition.role === "system" ? nextDefinition.role : nextDefinition.role;
    const builderProvider = getBuilderProviderForReview(phase, state.agents, activeTask) ?? undefined;
    const crossModelReview = Boolean(builderProvider && builderProvider !== agent.provider);
    setRunning(true);
    setNotice(null);
    try {
      const provider = mode === "subscription" ? subscriptionProviders[agent.provider] : mockProviders[agent.provider];
      if (mode === "subscription" && !providerStatus[agent.provider].subscriptionAuthenticated) {
        throw new Error(`${providerNames[agent.provider]} is needed for this step. ${providerStatus[agent.provider].detail}`);
      }
      const response = await provider.run({
        task: activeTask,
        project: activeProject,
        phase,
        agent,
        toRole,
        docs: activeProject.docs,
        builderProvider,
        crossModelReview,
        permissionDecisions: activeTask.permissionRequests ?? [],
      });
      const now = new Date().toISOString();
      const permissionRequests: PermissionRequest[] = response.permissionRequests.map((request) => ({
        ...request,
        id: makeId("permission"),
        status: "pending",
        createdAt: now,
      }));
      const needsPermission = permissionRequests.length > 0;
      const handoff: HandoffMessage = {
        id: makeId("handoff"),
        phase,
        fromRole: agent.role,
        toRole: needsPermission ? "human" : toRole,
        provider: agent.provider,
        agentName: agent.name,
        summary: response.summary,
        details: response.details,
        evidence: response.evidence,
        risks: response.risks,
        stance: response.stance,
        challenges: response.challenges,
        outcome: response.outcome,
        blockingFindings: response.blockingFindings,
        disagreement: response.disagreement,
        documentationUpdates: response.documentationUpdates,
        permissionRequests,
        builderProvider,
        nextAction: response.nextAction,
        decision: "proposed",
        createdAt: now,
        estimatedCost: response.usage.estimatedCost,
        tokens: response.usage.inputTokens + response.usage.outputTokens,
      };

      const verificationFailed = phase === "verify" && response.outcome !== "passed";
      const nextPhase = needsPermission ? phase : verificationFailed ? "fix" : transition.phase;
      const doneChecks = nextPhase === "done" ? evaluateDefinitionOfDone(activeTask, handoff) : activeTask.doneChecks;
      const canFinish = doneChecks ? allDoneChecksPass(doneChecks) : false;
      updateTask(activeTask.id, (task) => {
        const isDone = nextPhase === "done";
        const loopKind = getLoopKind(phase);
        const loopCounts = { ...(task.loopCounts ?? DEFAULT_LOOP_COUNTS) };
        if (loopKind === "fix") loopCounts.fix += 1;
        return {
          ...task,
          phase: isDone && !canFinish ? "fix" : nextPhase,
          pendingApproval: needsPermission ? null : transition.gate,
          status: needsPermission ? "blocked" : isDone ? (canFinish ? "done" : "blocked") : "active",
          round: task.round + 1,
          cost: 0,
          loopCounts,
          doneChecks,
          permissionRequests: [...permissionRequests, ...(task.permissionRequests ?? [])],
          updatedAt: now,
          handoffs: [handoff, ...task.handoffs],
          activity: [
            {
              id: makeId("activity"),
              label: isDone ? "Task completed" : `${agent.name} completed ${definition.label.toLowerCase()}`,
              detail: mode === "subscription" ? `${providerNames[agent.provider]} · subscription run` : `${providerNames[agent.provider]} · practice response`,
              createdAt: now,
            },
            ...task.activity,
          ],
        };
      });
      setNotice(
        needsPermission
          ? "A risky action needs your approval. Review the exact request before this phase can continue."
          : verificationFailed
            ? "Verification found a blocking problem. The task returned to Improve before it can be reviewed."
        : reroutedFrom
          ? `${providerNames[reroutedFrom]} was out of usage, so ${providerNames[agent.provider]} handled this step. ${response.nextAction}`
          : transition.gate
          ? "Independent review is ready. Resolve any disagreement, then decide."
          : transition.phase === "done" && !canFinish
            ? "Completion is blocked until every definition-of-done check passes."
            : response.nextAction,
      );
      if (mode === "subscription") void refreshProviderStatus().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The agent could not complete this step.");
      if (mode === "subscription") void refreshProviderStatus().catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }

  function resolveApproval(approved: boolean) {
    if (!activeTask?.pendingApproval) return;
    const gate = activeTask.pendingApproval;
    const now = new Date().toISOString();
    const latestOutcome = activeTask.handoffs[0]?.outcome ?? "changes_required";
    setState((current) => {
      const task = current.tasks.find((item) => item.id === activeTask.id);
      if (!task) return current;
      const loopKind = gate === "plan" ? "planning" : "review";
      const loopCounts = { ...(task.loopCounts ?? DEFAULT_LOOP_COUNTS) };
      if (!approved) loopCounts[loopKind] += 1;
      const loopLimits = task.loopLimits ?? DEFAULT_LOOP_LIMITS;
      const limitReached = !approved && loopCounts[loopKind] >= loopLimits[loopKind];
      const handoffs = task.handoffs.map((handoff, index) =>
        index === 0
          ? {
              ...handoff,
              decision: approved ? "accepted" as const : "changes_requested" as const,
              disagreement: approved && handoff.disagreement?.status === "open"
                ? { ...handoff.disagreement, status: "decided" as const, resolution: "The user explicitly reviewed both positions and chose this direction." }
                : handoff.disagreement,
            }
          : handoff,
      );
      const requestedPhase = approved ? phaseAfterApproval(gate, latestOutcome) : gate === "plan" ? "plan" : "code_review";
      const candidate: Task = {
        ...task,
        phase: requestedPhase,
        pendingApproval: null,
        status: limitReached ? "blocked" : "active",
        loopCounts,
        updatedAt: now,
        handoffs,
        activity: [
          {
            id: makeId("activity"),
            label: approved ? (gate === "plan" ? "Plan approved" : "Review findings accepted") : "Changes requested",
            detail: approved ? "Human gate cleared" : limitReached ? `${loopKind} loop limit reached` : "Returned to the responsible agent",
            createdAt: now,
          },
          ...task.activity,
        ],
      };
      const doneChecks = requestedPhase === "done" ? evaluateDefinitionOfDone(candidate) : candidate.doneChecks;
      const canFinish = doneChecks ? allDoneChecksPass(doneChecks) : false;
      const nextTask = requestedPhase === "done"
        ? { ...candidate, phase: canFinish ? "done" as const : "fix" as const, status: canFinish ? "done" as const : "blocked" as const, doneChecks }
        : candidate;
      const acceptedUpdates = approved ? handoffs[0]?.documentationUpdates ?? [] : [];
      return {
        ...current,
        tasks: current.tasks.map((item) => item.id === task.id ? nextTask : item),
        projects: current.projects.map((project) => project.id === task.projectId
          ? { ...project, docs: appendDocumentationUpdates(project.docs, acceptedUpdates, now) }
          : project),
      };
    });
    setNotice(approved
      ? gate === "findings" && latestOutcome === "passed" ? "The clean independent review was accepted. The task will finish only if every completion check passes." : "Approval recorded. The next agent can begin."
      : "The task has been returned for revision.");
  }

  function resolvePermission(requestId: string, decision: "approved" | "denied") {
    if (!activeTask) return;
    const request = activeTask.permissionRequests?.find((item) => item.id === requestId);
    if (!request) return;
    if (decision === "approved" && request.action === "modify_secrets") {
      setNotice("Secret changes are manual-only. The app cannot approve or perform them.");
      return;
    }
    const now = new Date().toISOString();
    updateTask(activeTask.id, (task) => ({
      ...task,
      status: "active",
      updatedAt: now,
      permissionRequests: (task.permissionRequests ?? []).map((item) => item.id === requestId ? { ...item, status: decision } : item),
      handoffs: task.handoffs.map((handoff) => ({
        ...handoff,
        permissionRequests: handoff.permissionRequests.map((item) => item.id === requestId ? { ...item, status: decision } : item),
      })),
      activity: [{ id: makeId("activity"), label: `Risky action ${decision}`, detail: request.summary, createdAt: now }, ...task.activity],
    }));
    setNotice(decision === "approved" ? "Approval recorded. Run this phase again to continue with that exact action." : "Request denied. Run this phase again so the agent can choose a safer path.");
  }

  async function reconcileDisagreement() {
    if (!activeTask || !activeProject || running) return;
    const handoff = activeTask.handoffs[0];
    if (!handoff?.disagreement || handoff.disagreement.status !== "open") return;
    const reconciliationCount = activeTask.reconciliationCount ?? 0;
    const reconciliationLimit = activeTask.reconciliationLimit ?? 1;
    if (reconciliationCount >= reconciliationLimit) {
      setNotice(`Reconciliation limit reached (${reconciliationLimit}). Both arguments remain available for your decision.`);
      return;
    }
    if (activeTask.round >= activeTask.roundLimit) {
      setNotice(`Round limit reached (${activeTask.roundLimit}).`);
      return;
    }
    const providerId = oppositeProvider(handoff.provider);
    const mode = activeTask.executionMode ?? "demo";
    const reviewer = state.agents.find((agent) => agent.role === "reviewer");
    if (!reviewer) return;
    if (mode === "subscription" && !providerStatus[providerId].subscriptionAuthenticated) {
      setNotice(`${providerNames[providerId]} is needed for the bounded reconciliation, but it is not currently connected.`);
      return;
    }
    setRunning(true);
    setNotice("Both positions are being reconsidered once.");
    try {
      const provider = mode === "subscription" ? subscriptionProviders[providerId] : mockProviders[providerId];
      const response = await provider.run({
        task: activeTask,
        project: activeProject,
        phase: handoff.phase,
        agent: { ...reviewer, provider: providerId, model: "Bounded disagreement reconciler" },
        toRole: "human",
        docs: activeProject.docs,
        builderProvider: handoff.builderProvider,
        crossModelReview: true,
        reconciliation: handoff.disagreement,
        permissionDecisions: activeTask.permissionRequests ?? [],
      });
      const now = new Date().toISOString();
      updateTask(activeTask.id, (task) => ({
        ...task,
        round: task.round + 1,
        cost: 0,
        reconciliationCount: (task.reconciliationCount ?? 0) + 1,
        updatedAt: now,
        handoffs: task.handoffs.map((item, index) => index === 0 ? {
          ...item,
          disagreement: response.disagreement?.status && response.disagreement.status !== "none" ? response.disagreement : item.disagreement,
          evidence: [...item.evidence, ...response.evidence.map((entry) => `Reconciliation: ${entry}`)],
          risks: [...item.risks, ...response.risks],
          documentationUpdates: [...item.documentationUpdates, ...response.documentationUpdates],
        } : item),
        activity: [{ id: makeId("activity"), label: "Bounded reconciliation completed", detail: `${providerNames[providerId]} reconsidered both recorded positions`, createdAt: now }, ...task.activity],
      }));
      setNotice(response.disagreement?.status === "reconciled" ? "A model-backed resolution was recorded. You can now decide." : "The disagreement remains open. Both arguments are preserved for your decision.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The reconciliation step could not complete.");
    } finally {
      setRunning(false);
    }
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const repositoryPath = String(form.get("repositoryPath") ?? "").trim() || undefined;
    if (!name) return;
    const id = makeId("project");
    const now = new Date().toISOString();
    const docs = createDefaultDocs(now).map((doc) => ({
      ...doc,
      id: makeId("doc"),
      updatedAt: now,
    }));
    setState((current) => ({
      ...current,
      activeProjectId: id,
      activeTaskId: "",
      projects: [...current.projects, { id, name, description, repositoryPath, createdAt: now, docs }],
    }));
    setActiveDocId(docs[0].id);
    setView("tasks");
    setModal(null);
    setNotice("Project created. Add its first task when you are ready.");
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const brief = String(form.get("brief") ?? "").trim();
    const title = String(form.get("title") ?? "").trim() || taskTitleFromBrief(brief);
    if (!brief) return;
    const now = new Date().toISOString();
    const repositoryPath = String(form.get("repositoryPath") ?? "").trim() || activeProject?.repositoryPath;
    const executionMode = String(form.get("executionMode") ?? "demo") === "subscription" ? "subscription" : "demo";
    if (executionMode === "subscription" && !repositoryPath) {
      setNotice("Choose the coding project folder before using your subscriptions.");
      return;
    }
    const newProjectId = activeProject?.id ?? makeId("project");
    const suppliedProjectName = String(form.get("projectName") ?? "").trim();
    const inferredProjectName = repositoryPath?.split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ");
    const projectName = suppliedProjectName || inferredProjectName || "My project";
    const docs = activeProject?.docs ?? createDefaultDocs(now).map((doc) => ({ ...doc, id: makeId("doc") }));
    const task: Task = {
      id: makeId("task"),
      projectId: newProjectId,
      title,
      brief,
      phase: "explore",
      status: "active",
      round: 0,
      roundLimit: Number(form.get("roundLimit") ?? 12),
      cost: 0,
      costLimit: 1_000_000,
      pendingApproval: null,
      importance: String(form.get("importance") ?? "important") === "standard" ? "standard" : "important",
      executionMode,
      loopCounts: { ...DEFAULT_LOOP_COUNTS },
      loopLimits: {
        planning: Number(form.get("planningLimit") ?? DEFAULT_LOOP_LIMITS.planning),
        review: Number(form.get("reviewLimit") ?? DEFAULT_LOOP_LIMITS.review),
        fix: Number(form.get("fixLimit") ?? DEFAULT_LOOP_LIMITS.fix),
      },
      reconciliationCount: 0,
      reconciliationLimit: 1,
      handoffs: [],
      activity: [],
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => ({
      ...current,
      activeProjectId: newProjectId,
      activeTaskId: task.id,
      projects: activeProject
        ? current.projects.map((project) => project.id === activeProject.id ? { ...project, repositoryPath } : project)
        : [...current.projects, {
            id: newProjectId,
            name: projectName,
            description: brief.slice(0, 240),
            repositoryPath,
            createdAt: now,
            docs,
          }],
      tasks: [task, ...current.tasks],
    }));
    setActiveDocId(docs[0]?.id ?? "");
    setView("run");
    setModal(null);
    setNotice(executionMode === "subscription"
      ? "Task created. The app will use an available signed-in subscription and pause if an important second opinion cannot run. It never uses an API key."
      : "Task created in practice mode. No model is called and no code will be changed.");
  }

  function updateLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTask) return;
    const form = new FormData(event.currentTarget);
    updateTask(activeTask.id, (task) => ({
      ...task,
      roundLimit: Math.max(task.round, Number(form.get("roundLimit") ?? task.roundLimit)),
      loopLimits: {
        planning: Math.max(task.loopCounts?.planning ?? 0, Number(form.get("planningLimit") ?? task.loopLimits?.planning ?? DEFAULT_LOOP_LIMITS.planning)),
        review: Math.max(task.loopCounts?.review ?? 0, Number(form.get("reviewLimit") ?? task.loopLimits?.review ?? DEFAULT_LOOP_LIMITS.review)),
        fix: Math.max(task.loopCounts?.fix ?? 0, Number(form.get("fixLimit") ?? task.loopLimits?.fix ?? DEFAULT_LOOP_LIMITS.fix)),
      },
      status: task.status === "blocked" ? "active" : task.status,
      updatedAt: new Date().toISOString(),
    }));
    setModal(null);
    setNotice("Safety stops updated. These limits do not represent money.");
  }

  function updateDoc(content: string) {
    if (!activeProject || !activeDoc) return;
    setState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              docs: project.docs.map((doc) =>
                doc.id === activeDoc.id ? { ...doc, content, updatedAt: new Date().toISOString() } : doc,
              ),
            }
          : project,
      ),
    }));
  }

  function updateAgent(role: AgentRole, patch: Partial<{ provider: ProviderId; model: string }>) {
    setState((current) => ({
      ...current,
      agents: current.agents.map((agent) => {
        if (agent.role !== role) return agent;
        const provider = patch.provider ?? agent.provider;
        return { ...agent, ...patch, model: patch.model ?? agentModelLabel(role, provider) };
      }),
    }));
  }

  function applyRecommendedAgentSetup() {
    setState((current) => ({
      ...current,
      agents: current.agents.map((agent) => {
        const provider: ProviderId = agent.role === "architect" ? "anthropic" : "openai";
        return { ...agent, provider, model: agentModelLabel(agent.role, provider) };
      }),
    }));
    setNotice("Recommended team applied: Claude plans, Codex builds and tests, and important reviews switch to the opposite AI automatically.");
  }

  async function chooseProjectFolder(): Promise<string | null> {
    if (!window.aiDevOrchestrator) {
      setNotice("Folder selection is available in the installed Mac app. The browser preview stays in practice mode.");
      return null;
    }
    return window.aiDevOrchestrator.selectProjectFolder();
  }

  const openTaskCount = projectTasks.filter((task) => task.status !== "done").length;

  function toggleSidebar() {
    setSidebarCollapsed((current) => !current);
  }

  return (
    <>
      {showLaunchIntro && <LaunchIntro />}
      <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-launching={showLaunchIntro}>
      <aside className="project-rail" aria-label="Project navigation">
        <div className="rail-brand">
          <button className="wordmark" type="button" onClick={() => setView("run")} aria-label="Open build workspace">
            <span className="wordmark-mark" aria-hidden="true" />
            <span className="wordmark-copy">AI Dev Orchestrator</span>
          </button>
          <button className="rail-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <span className="rail-toggle-icon" data-collapsed={sidebarCollapsed} aria-hidden="true" />
          </button>
        </div>
        <div className="rail-actions">
          <button className="primary-action" type="button" onClick={() => setModal("task")}>
            <span className="rail-action-icon" aria-hidden="true">+</span>
            <span className="rail-action-label">New request</span>
          </button>
          <button className="rail-quiet-action" type="button" onClick={() => setModal("project")}>
            <span className="rail-action-icon rail-project-icon" aria-hidden="true" />
            <span className="rail-action-label">New project</span>
          </button>
        </div>
        <div className="rail-signal" aria-label="Independent review route is active">
          <div className="rail-signal-route" aria-hidden="true"><span>O</span><i /><span>C</span></div>
          <div><small>Review route</small><strong>Codex ↔ Claude</strong></div>
        </div>
        <div className="rail-section">
          <p className="section-label">Projects</p>
          {state.projects.map((project, index) => {
            const count = state.tasks.filter((task) => task.projectId === project.id && task.status !== "done").length;
            return (
              <button
                className={`project-row ${project.id === activeProject?.id ? "project-row-active" : ""}`}
                type="button"
                key={project.id}
                onClick={() => selectProject(project.id)}
                aria-label={`${project.name}, ${count} open ${count === 1 ? "task" : "tasks"}`}
              >
                <span className="project-index">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{project.name}</strong><small>{count} open {count === 1 ? "task" : "tasks"}</small></span>
              </button>
            );
          })}
          {!state.projects.length && <p className="rail-empty-copy">No projects yet.</p>}
        </div>
        <div className="rail-foot">
          <span>Protocol v1</span>
          <span>Private workspace</span>
        </div>
      </aside>

      <header className="topbar">
        <nav className="topnav" aria-label="Primary navigation">
          {(["run", "tasks", "docs", "usage", "settings"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setView(item)} aria-current={view === item ? "page" : undefined}>
              {item === "run" ? "Build" : item === "tasks" ? "Requests" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="system-status">
          <span className={`status-dot status-${storageStatus}`} aria-hidden="true" />
          <span>{storageStatus === "loading" ? "Loading" : storageStatus === "saved" ? "Saved locally" : "Session mode"}</span>
          <button className="brain-sync" type="button" onClick={() => setView("settings")} aria-label={`Second Brain: ${secondBrainStatus.detail}`}>
            <i data-connected={secondBrainStatus.connected && secondBrainStatus.writable} />
            {secondBrainStatus.connected && secondBrainStatus.writable ? "Brain synced" : "Brain offline"}
          </button>
          <button className="usage-quick" type="button" onClick={() => setView("usage")} aria-label="Open subscription usage">
            <span><i data-state={providerStatus.openai.usage.state} />Codex {quickUsageLabel(providerStatus.openai)}</span>
            <span><i data-state={providerStatus.anthropic.usage.state} />Claude {quickUsageLabel(providerStatus.anthropic)}</span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="main-surface" aria-live="polite">
          {(providerStatus.openai.usage.state === "limit_reached" || providerStatus.anthropic.usage.state === "limit_reached") && (
            <div className="usage-alert" role="alert">
              <span><strong>One subscription is temporarily out of usage.</strong> The app will use the available model for ordinary steps and pause any important independent review that requires the unavailable model.</span>
              <button type="button" onClick={() => setView("usage")}>See usage</button>
            </div>
          )}
          {notice && (
            <div className="notice-bar" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button>
            </div>
          )}
          <div className="view-stage" key={view}>
          {view === "run" && !activeTask && (
            <StartTaskView
              projectName={activeProject?.name}
              repositoryPath={activeProject?.repositoryPath}
              providerStatus={providerStatus}
              onChooseFolder={chooseProjectFolder}
              onSubmit={createTask}
            />
          )}
          {view === "run" && activeTask && (
            <RunView
              task={activeTask}
              projectName={activeProject?.name ?? "No project"}
              agents={state.agents}
              running={running}
              onRun={runNextPhase}
              onApprove={() => resolveApproval(true)}
              onReject={() => resolveApproval(false)}
              onReconcile={reconcileDisagreement}
              onResolvePermission={resolvePermission}
              onOpenSettings={() => setModal("settings")}
              onCreateTask={() => setModal("task")}
            />
          )}
          {view === "tasks" && (
            <TasksView tasks={projectTasks} openCount={openTaskCount} onSelect={selectTask} onCreate={() => setModal("task")} />
          )}
          {view === "docs" && (activeProject ? (
            <DocsView
              projectName={activeProject.name}
              docs={activeProject.docs}
              activeDocId={activeDoc?.id ?? ""}
              onSelect={setActiveDocId}
              onChange={updateDoc}
              storageStatus={storageStatus}
            />
          ) : (
            <DocsEmptyView onCreateRequest={() => setModal("task")} onCreateProject={() => setModal("project")} />
          ))}
          {view === "agents" && (
            <AgentsView agents={state.agents} providerStatus={providerStatus} onUpdate={updateAgent} onApplyRecommended={applyRecommendedAgentSetup} />
          )}
          {view === "usage" && (
            <UsageView providerStatus={providerStatus} refreshing={refreshingProviders} onRefresh={() => void refreshProviderStatus().catch(() => undefined)} />
          )}
          {view === "settings" && <SettingsHome secondBrainStatus={secondBrainStatus} onOpenAgents={() => setView("agents")} onOpenPolicy={() => setView("policy")} />}
          {view === "policy" && <PolicyView />}
          </div>
        </section>
      </div>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setModal(null);
        }}>
          <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" type="button" onClick={() => setModal(null)} aria-label="Close dialog">×</button>
            {modal === "project" && <ProjectForm onChooseFolder={chooseProjectFolder} onSubmit={createProject} />}
            {modal === "task" && (
              <TaskForm
                projectName={activeProject?.name}
                repositoryPath={activeProject?.repositoryPath}
                providerStatus={providerStatus}
                onChooseFolder={chooseProjectFolder}
                onSubmit={createTask}
              />
            )}
            {modal === "settings" && activeTask && <SettingsForm task={activeTask} onSubmit={updateLimits} />}
          </div>
        </div>
      )}
      </main>
    </>
  );
}

function LaunchIntro() {
  return (
    <div className="launch-intro" aria-hidden="true">
      <div className="launch-intro-grid" />
      <div className="launch-lockup">
        <svg className="launch-mark" viewBox="0 0 1024 1024" role="presentation">
          <path className="launch-arc" pathLength="1" d="M365 652 Q512 492 659 652" />
          <path className="launch-a" pathLength="1" d="M286 760 468 304 Q484 264 512 264 Q540 264 556 304 L738 760" />
        </svg>
        <div className="launch-copy">
          <span>AI Dev Orchestrator</span>
          <i>Build with a second opinion.</i>
        </div>
      </div>
      <div className="launch-rule" />
    </div>
  );
}

function RunView({
  task,
  projectName,
  agents,
  running,
  onRun,
  onApprove,
  onReject,
  onReconcile,
  onResolvePermission,
  onOpenSettings,
  onCreateTask,
}: {
  task?: Task;
  projectName: string;
  agents: OrchestratorState["agents"];
  running: boolean;
  onRun: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReconcile: () => void;
  onResolvePermission: (requestId: string, decision: "approved" | "denied") => void;
  onOpenSettings: () => void;
  onCreateTask: () => void;
}) {
  if (!task) {
    return (
      <div className="empty-state">
        <p className="eyebrow">No tasks yet</p>
        <h2>Give the agent team a clear outcome.</h2>
        <p>The first run starts in Explore and pauses automatically at the plan approval gate.</p>
        <button className="approve-action" type="button" onClick={onCreateTask}>Create first task</button>
      </div>
    );
  }

  const definition = getPhaseDefinition(task.phase);
  const currentIndex = getPhaseIndex(task.phase);
  const actor = resolveAgentForPhase(task.phase, agents, task);
  const block = getExecutionBlock(task);
  const latestHandoff = task.handoffs[0];
  const roundPercent = Math.min(100, Math.round((task.round / task.roundLimit) * 100));
  const operatingMode = getOperatingMode(task.phase);
  const loopCounts = task.loopCounts ?? DEFAULT_LOOP_COUNTS;
  const loopLimits = task.loopLimits ?? DEFAULT_LOOP_LIMITS;
  const doneChecks = task.doneChecks ?? evaluateDefinitionOfDone(task);
  const pendingPermissions = (task.permissionRequests ?? []).filter((request) => request.status === "pending");

  return (
    <div className="run-view">
      <div className="run-header">
        <div>
          <p className="eyebrow">{projectName} · {definition.label}</p>
          <div className="mode-line"><span>Mode · {operatingMode}</span><span>{task.importance === "standard" ? "One-agent review" : "Important · independent second opinion"}</span><span>{task.executionMode === "subscription" ? "Builds in your selected folder" : "Practice only · no code changes"}</span></div>
          <h2>{task.title}</h2>
          <p className="run-brief">{task.brief}</p>
        </div>
        <button className="quiet-button" type="button" onClick={onOpenSettings}>Advanced controls</button>
      </div>

      <div className="progress-summary">
        <span>{progressPercent(task.phase)}% through protocol</span>
        <span>{task.status === "done" ? "Complete" : task.pendingApproval ? "Waiting on you" : `${definition.label} active`}</span>
      </div>
      <ol className="phase-track" aria-label="Task progress">
        {WORKFLOW.map((phase, index) => (
          <li className={index < currentIndex || task.phase === "done" ? "phase-complete" : index === currentIndex ? "phase-current" : ""} key={phase.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{phase.shortLabel}</strong>
          </li>
        ))}
      </ol>

      <div className="working-grid">
        <div className="run-column">
          <section className={`phase-panel ${task.pendingApproval ? "gate-panel" : ""}`} aria-labelledby="phase-heading">
            <div className="panel-heading">
              <div>
                <p className="section-label">{task.pendingApproval ? "Awaiting your decision" : task.phase === "done" ? "Run complete" : "Current phase"}</p>
                <h3 id="phase-heading">
                  {task.pendingApproval === "plan" ? "Approve the plan" : task.pendingApproval === "findings" ? "Accept review findings" : definition.label}
                </h3>
              </div>
              <span className={`phase-badge ${task.pendingApproval ? "gate-badge" : ""}`}>
                {task.pendingApproval ? "Your decision" : task.phase === "done" ? "Finished" : actor ? `${actor.name} · ${task.executionMode === "subscription" ? "Subscription" : "Practice"}` : "System"}
              </span>
            </div>

            {task.phase !== "done" && (
              <div className="handoff-route" aria-label="Current agent route">
                {latestHandoff ? (
                  <>
                    <AgentIdentity role={latestHandoff.fromRole} label={latestHandoff.agentName} sublabel={`${providerNames[latestHandoff.provider]} · ${task.executionMode === "subscription" ? "Subscription" : "Practice"}`} />
                    <span className="route-line" aria-hidden="true"><i>→</i></span>
                    <AgentIdentity role={latestHandoff.toRole} label={latestHandoff.toRole === "human" ? "You" : latestHandoff.toRole === "system" ? "System" : getPhaseDefinition(getNextPhase(latestHandoff.phase)).label} sublabel="Next owner" light />
                  </>
                ) : actor ? (
                  <>
                    <AgentIdentity role={actor.role} label={actor.name} sublabel={`${providerNames[actor.provider]} · ${task.executionMode === "subscription" ? "Subscription" : "Practice"}`} />
                    <span className="route-line" aria-hidden="true"><i>→</i></span>
                    <div className="route-destination"><span>Next</span><strong>{getPhaseDefinition(getNextPhase(task.phase)).label}</strong></div>
                  </>
                ) : null}
              </div>
            )}

            {latestHandoff ? <HandoffBody handoff={latestHandoff} /> : (
              <div className="phase-empty-copy">
                <p>{definition.description}</p>
                <p>{task.executionMode === "subscription" ? "The connected coding agent will use your full pasted request, the selected project folder, and the shared project documents." : "Practice mode shows how the workflow works without calling a model or changing code."}</p>
              </div>
            )}

            {task.pendingApproval && latestHandoff?.disagreement?.status === "open" && (
              <div className="reconciliation-callout">
                <div><span>Open disagreement</span><strong>Both model positions are preserved below.</strong></div>
                <button type="button" onClick={onReconcile} disabled={(task.reconciliationCount ?? 0) >= (task.reconciliationLimit ?? 1)}>
                  {(task.reconciliationCount ?? 0) >= (task.reconciliationLimit ?? 1) ? "Reconciliation used" : "Run bounded reconciliation"}
                </button>
              </div>
            )}

            {pendingPermissions.length > 0 && (
              <div className="permission-gate" role="alert">
                <div><span>Approval required</span><strong>The agent stopped before a risky action.</strong></div>
                {pendingPermissions.map((request) => (
                  <section key={request.id}>
                    <p><strong>{request.summary}</strong>{request.command && <code>{request.command}</code>}{request.targets.length > 0 && <small>Targets: {request.targets.join(", ")}</small>}</p>
                    <div>
                      <button className="secondary-action" type="button" onClick={() => onResolvePermission(request.id, "denied")}>Deny</button>
                      <button className="approve-action" type="button" disabled={request.action === "modify_secrets"} onClick={() => onResolvePermission(request.id, "approved")}>{request.action === "modify_secrets" ? "Manual only" : "Approve exact action"}</button>
                    </div>
                  </section>
                ))}
              </div>
            )}

            <div className="gate-actions">
              {task.pendingApproval ? (
                <>
                  <div className="approval-explainer"><strong>{task.pendingApproval === "plan" ? "Nothing has been built yet." : "The code was built and checked."}</strong><span>{task.pendingApproval === "plan" ? "Review the plan, then approve before code changes begin." : "Accept the review findings before the final improvement pass."}</span></div>
                  <button className="secondary-action" type="button" onClick={onReject}>Ask for changes</button>
                  <button className="approve-action" type="button" onClick={onApprove}>{task.pendingApproval === "plan" ? "Approve plan" : "Accept findings"}</button>
                </>
              ) : task.phase !== "done" && pendingPermissions.length === 0 ? (
                <button className="approve-action run-action" type="button" onClick={onRun} disabled={running || Boolean(block)}>
                  {running ? <><span className="running-mark" aria-hidden="true" /> {actor?.name} is working</> : block ?? `Run ${definition.label.toLowerCase()}`}
                </button>
              ) : (
                <span className="done-note">Built, checked, independently reviewed, and finished.</span>
              )}
            </div>
          </section>

          {task.handoffs.length > 1 && (
            <section className="handoff-history" aria-labelledby="history-heading">
              <div className="history-heading">
                <div><p className="section-label">Audit trail</p><h3 id="history-heading">Earlier handoffs</h3></div>
                <span>{task.handoffs.length - 1} messages</span>
              </div>
              {task.handoffs.slice(1).map((handoff) => (
                <details key={handoff.id}>
                  <summary>
                    <span className="history-role">{roleInitials(handoff.fromRole)}</span>
                    <span><strong>{handoff.summary}</strong><small>{getPhaseDefinition(handoff.phase).label} · {formatTime(handoff.createdAt)}</small></span>
                    <span className={`decision decision-${handoff.decision}`}>{handoff.decision.replace("_", " ")}</span>
                  </summary>
                  <HandoffBody handoff={handoff} compact />
                </details>
              ))}
            </section>
          )}
        </div>

        <aside className="run-context" aria-label="Safety stops and activity">
          <div className="context-section">
            <div className="context-title"><p className="section-label">Safety stops</p><button type="button" onClick={onOpenSettings}>Edit</button></div>
            <p className="context-help">These stop an endless AI loop. They are not charges or prices.</p>
            <dl className="limit-list">
              <div><dt><span>Agent steps used</span><i><b style={{ width: `${roundPercent}%` }} /></i></dt><dd>{task.round} / {task.roundLimit}</dd></div>
              <div><dt><span>Current connection</span></dt><dd>{task.executionMode === "subscription" ? "Subscription" : "Practice"}</dd></div>
            </dl>
          </div>
          <div className="context-section">
            <p className="section-label">Revision stop rules</p>
            <dl className="loop-list">
              <div><dt>Planning revisions</dt><dd>{loopCounts.planning} / {loopLimits.planning}</dd></div>
              <div><dt>Review revisions</dt><dd>{loopCounts.review} / {loopLimits.review}</dd></div>
              <div><dt>Fix rounds</dt><dd>{loopCounts.fix} / {loopLimits.fix}</dd></div>
              <div><dt>Reconciliation</dt><dd>{task.reconciliationCount ?? 0} / {task.reconciliationLimit ?? 1}</dd></div>
            </dl>
          </div>
          <div className="context-section">
            <p className="section-label">Agent team</p>
            <div className="mini-agent-list">
              {agents.map((agent) => (
                <div key={agent.role}><span>{roleInitials(agent.role)}</span><p><strong>{agent.name}</strong><small>{agent.role === "reviewer" ? "Automatic · opposite builder" : providerNames[agent.provider]}</small></p></div>
              ))}
            </div>
          </div>
          <div className="context-section">
            <p className="section-label">Definition of done</p>
            <ul className="done-checklist">
              <li data-pass={doneChecks.verificationPassed}>Verification passed</li>
              <li data-pass={doneChecks.independentReviewPassed}>Independent review</li>
              <li data-pass={doneChecks.approvalsCleared}>Approvals cleared</li>
              <li data-pass={doneChecks.noOpenDisagreement}>No open disagreement</li>
            </ul>
          </div>
          <div className="context-section activity-list">
            <p className="section-label">Recent activity</p>
            {task.activity.length ? task.activity.slice(0, 5).map((item) => (
              <div key={item.id}><span>{formatTime(item.createdAt)}</span><p><strong>{item.label}</strong><small>{item.detail}</small></p></div>
            )) : <p className="muted-copy">Activity appears after the first agent run.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function AgentIdentity({ role, label, sublabel, light = false }: { role: AgentRole | "human" | "system"; label: string; sublabel: string; light?: boolean }) {
  return (
    <div className="agent-identity">
      <span className={`agent-avatar ${light ? "agent-avatar-light" : ""}`}>{roleInitials(role)}</span>
      <p><strong>{label}</strong><small>{sublabel}</small></p>
    </div>
  );
}

function HandoffBody({ handoff, compact = false }: { handoff: HandoffMessage; compact?: boolean }) {
  return (
    <div className={`handoff-body ${compact ? "handoff-body-compact" : ""}`}>
      <div className={`handoff-outcome outcome-${handoff.outcome}`}><span>Result</span><strong>{handoff.outcome.replace("_", " ")}</strong></div>
      <p className="handoff-summary">{handoff.summary}</p>
      {handoff.stance && (
        <div className="challenge-block">
          <div><span>Reviewer stance</span><strong>{handoff.stance}</strong></div>
          {handoff.challenges?.map((challenge) => <p key={challenge}>{challenge}</p>)}
        </div>
      )}
      {handoff.details.length > 0 && (
        <div className="handoff-section">
          <p className="section-label">Output</p>
          <ol>{handoff.details.map((detail) => <li key={detail}>{detail}</li>)}</ol>
        </div>
      )}
      <div className="evidence-grid">
        {handoff.evidence.length > 0 && <div><p className="section-label">Evidence</p>{handoff.evidence.map((item) => <p key={item}>{item}</p>)}</div>}
        {handoff.risks.length > 0 && <div><p className="section-label">Open risk</p>{handoff.risks.map((item) => <p key={item}>{item}</p>)}</div>}
      </div>
      {handoff.blockingFindings.length > 0 && <div className="blocking-findings"><p className="section-label">Blocking findings</p>{handoff.blockingFindings.map((item) => <p key={item}>{item}</p>)}</div>}
      {handoff.documentationUpdates.length > 0 && <div className="doc-update-preview"><p className="section-label">Shared memory update</p>{handoff.documentationUpdates.map((item) => <p key={`${item.path}-${item.summary}`}><strong>{item.path}</strong><span>{item.summary}</span></p>)}</div>}
      {handoff.disagreement && handoff.disagreement.status !== "none" && (
        <div className={`disagreement-block disagreement-${handoff.disagreement.status}`}>
          <div className="disagreement-heading"><span>Model disagreement</span><strong>{handoff.disagreement.status}</strong></div>
          <p>{handoff.disagreement.summary}</p>
          {handoff.disagreement.arguments?.map((argument) => (
            <div className="model-argument" key={`${argument.provider}-${argument.position}`}>
              <span>{providerNames[argument.provider]}</span><p>{argument.position}</p>
            </div>
          ))}
          {handoff.disagreement.resolution && <div className="resolution"><span>Recorded resolution</span><p>{handoff.disagreement.resolution}</p></div>}
        </div>
      )}
      <div className="next-action"><span>Next action</span><strong>{handoff.nextAction}</strong></div>
    </div>
  );
}

function TasksView({ tasks, openCount, onSelect, onCreate }: { tasks: Task[]; openCount: number; onSelect: (id: string) => void; onCreate: () => void }) {
  return (
    <div className="collection-view">
      <div className="collection-header">
        <div><p className="eyebrow">Your requests</p><h2>{openCount} in progress</h2><p>Each request is planned, approved by you, built, tested, and independently reviewed.</p></div>
        <button className="approve-action" type="button" onClick={onCreate}>Paste a new request</button>
      </div>
      {tasks.length ? (
        <div className="task-table">
          <div className="task-table-head" aria-hidden="true"><span>Request</span><span>What is happening</span><span>Connection</span><span>Updated</span></div>
          {tasks.map((task) => (
            <button className="task-row" type="button" key={task.id} onClick={() => onSelect(task.id)}>
              <span className="task-name"><strong>{task.title}</strong><small>{task.brief}</small></span>
              <span><i className={`status-chip status-chip-${task.status}`}>{getPhaseDefinition(task.phase).label}</i></span>
              <span className="task-usage"><strong>{task.executionMode === "subscription" ? "Real project" : "Practice"}</strong><small>{task.round} agent steps completed</small></span>
              <span className="task-updated">{formatTime(task.updatedAt)} <i aria-hidden="true">→</i></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="collection-empty"><h3>No requests yet</h3><p>Paste anything about what you want to build. The app will organize the rest.</p><button className="approve-action" type="button" onClick={onCreate}>Paste your first request</button></div>
      )}
    </div>
  );
}

function DocsView({
  projectName,
  docs,
  activeDocId,
  onSelect,
  onChange,
  storageStatus,
}: {
  projectName: string;
  docs: OrchestratorState["projects"][number]["docs"];
  activeDocId: string;
  onSelect: (id: string) => void;
  onChange: (content: string) => void;
  storageStatus: StorageStatus;
}) {
  const doc = docs.find((item) => item.id === activeDocId) ?? docs[0];
  if (!doc) return null;
  return (
    <div className="docs-view">
      <div className="docs-header"><div><p className="eyebrow">Shared context · {projectName}</p><h2>Project documents</h2></div><span>{storageStatus === "saved" ? "Changes saved" : "Session changes"}</span></div>
      <div className="docs-grid">
        <nav className="docs-list" aria-label="Project documents">
          {docs.map((item, index) => (
            <button className={item.id === doc.id ? "doc-active" : ""} type="button" key={item.id} onClick={() => onSelect(item.id)}>
              <span>{String(index + 1).padStart(2, "0")}</span><p><strong>{item.path}</strong><small>{item.title}</small></p>
            </button>
          ))}
        </nav>
        <section className="doc-editor" aria-labelledby="doc-title">
          <div><p className="section-label">{doc.path}</p><h3 id="doc-title">{doc.title}</h3><p>{doc.description}</p></div>
          <label htmlFor="doc-content">Document content</label>
          <textarea id="doc-content" value={doc.content} onChange={(event) => onChange(event.target.value)} spellCheck="true" />
          <p className="editor-note">This is the shared memory for every agent working on this project. Important decisions should live here, not only inside a chat.</p>
        </section>
      </div>
    </div>
  );
}

function DocsEmptyView({ onCreateRequest, onCreateProject }: { onCreateRequest: () => void; onCreateProject: () => void }) {
  const files = ["AGENTS.md", "CLAUDE.md", "AI_DEV_PROTOCOL.md", "PRODUCT.md", "ARCHITECTURE.md", "DECISIONS.md"];
  return (
    <div className="docs-empty-view">
      <div className="docs-empty-copy">
        <p className="eyebrow">Shared project memory</p>
        <h2>Nothing is missing. Docs begin with your first project.</h2>
        <p>These are not random files from your Mac. They are the instructions, decisions, and project facts that Codex and Claude share so important context does not disappear inside a chat.</p>
        <div className="docs-empty-actions">
          <button className="approve-action" type="button" onClick={onCreateRequest}>Paste your first request</button>
          <button className="secondary-action" type="button" onClick={onCreateProject}>Create a project first</button>
        </div>
      </div>
      <div className="doc-seed-preview" aria-label="Documents created for every project">
        <p className="section-label">Created automatically</p>
        {files.map((file, index) => (
          <div key={file} style={{ "--doc-order": index } as CSSProperties}>
            <span>{String(index + 1).padStart(2, "0")}</span><strong>{file}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatUsageReset(value?: number): string {
  if (!value) return "Reset time unavailable";
  return `Resets ${new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value * 1000))}`;
}

function ProviderUsageCard({ connection }: { connection: ProviderConnection }) {
  const usageUrl = connection.provider === "openai"
    ? "https://chatgpt.com/codex/settings/usage"
    : "https://claude.ai/settings/usage";
  const statusLabel = !connection.subscriptionAuthenticated
    ? "Not connected"
    : connection.usage.state === "limit_reached"
      ? "Limit reached"
      : connection.usage.state === "near_limit"
        ? "Near limit"
        : connection.usage.state === "available"
          ? "Available"
          : "Connected";
  return (
    <article className="usage-card" data-provider={connection.provider} data-state={connection.usage.state}>
      <header>
        <div className="usage-provider-mark" aria-hidden="true">{connection.provider === "openai" ? "CX" : "CL"}</div>
        <div><p className="section-label">{connection.provider === "openai" ? "ChatGPT subscription" : "Claude subscription"}</p><h3>{connection.label}</h3></div>
        <span className="usage-state"><i aria-hidden="true" />{statusLabel}</span>
      </header>
      <p className="usage-summary">{connection.usage.summary}</p>
      {connection.usage.windows.length ? (
        <div className="usage-windows">
          {connection.usage.windows.map((window) => (
            <div className="usage-window" key={window.id}>
              {typeof window.usedPercent === "number" ? (
                <>
                  <div><strong>{window.label}</strong><span>{100 - window.usedPercent}% remaining</span></div>
                  <div className="usage-meter" role="progressbar" aria-label={`${window.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent}>
                    <i style={{ width: `${window.usedPercent}%` }} />
                  </div>
                  <div><small>{window.usedPercent}% used</small><small>{window.resetsLabel ? `Resets ${window.resetsLabel}` : formatUsageReset(window.resetsAt)}</small></div>
                </>
              ) : (
                <>
                  <div><strong>{window.label}</strong><span>{connection.usage.state === "limit_reached" ? "Limit reached" : connection.usage.state === "near_limit" ? "Near limit" : "Within limits"}</span></div>
                  <div><small>No percentage reported for this window.</small><small>{window.resetsLabel ? `Resets ${window.resetsLabel}` : formatUsageReset(window.resetsAt)}</small></div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="usage-unavailable">
          <strong>{!connection.subscriptionAuthenticated
            ? "Connect this subscription in the installed Mac app"
            : connection.provider === "anthropic" ? "Claude usage is temporarily unavailable" : "Usage percentage unavailable"}</strong>
          <p>{!connection.subscriptionAuthenticated
            ? "The browser preview cannot read subscriptions. Open the installed app to check the account signed in on this Mac."
            : connection.provider === "anthropic"
              ? "Claude reports its subscription percentages through its own usage command, which costs nothing. This reading refreshes automatically; if it stays empty, confirm Claude Code is signed in to a subscription rather than an API key."
              : "The official Codex usage service did not return a percentage. Open the provider page for the authoritative account view."}</p>
        </div>
      )}
      {connection.provider === "openai" && connection.usage.credits && (
        <div className="credits-clarity">
          <span>Optional paid credits</span>
          <strong>{connection.usage.credits.balance}</strong>
          <p>Zero paid credits does not mean your included subscription usage is empty. This app never buys or automatically tops up credits.</p>
        </div>
      )}
      <footer>
        <span>{connection.usage.source === "live" ? "Live provider reading" : connection.usage.source === "last_run" ? "Last real agent reading" : "Connection status only"}</span>
        <a href={usageUrl} target="_blank" rel="noreferrer">{connection.provider === "anthropic" ? "Check Claude usage" : "Open official usage"} <span aria-hidden="true">↗</span></a>
      </footer>
    </article>
  );
}

function UsageView({ providerStatus, refreshing, onRefresh }: { providerStatus: ProviderStatusResponse; refreshing: boolean; onRefresh: () => void }) {
  const routing = providerRoutingCopy(providerStatus);
  return (
    <div className="usage-view">
      <div className="collection-header usage-header">
        <div><p className="eyebrow">Usage</p><h2>Codex and Claude</h2></div>
        <button className="approve-action" type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Checking…" : "Refresh status"}</button>
      </div>
      <div className={`routing-status ${routing.blocked ? "routing-status-blocked" : ""}`}>
        <div><span className="section-label">Routing</span><h3>{routing.title}</h3></div>
        <p>{routing.detail}</p>
      </div>
      <div className="usage-grid">
        <ProviderUsageCard connection={providerStatus.openai} />
        <ProviderUsageCard connection={providerStatus.anthropic} />
      </div>
    </div>
  );
}

function SettingsHome({ secondBrainStatus, onOpenAgents, onOpenPolicy }: { secondBrainStatus: SecondBrainStatus; onOpenAgents: () => void; onOpenPolicy: () => void }) {
  return (
    <div className="collection-view settings-home">
      <div className="collection-header">
        <div><p className="eyebrow">Settings</p><h2>Advanced setup</h2><p>The everyday workflow stays under Build. These controls are here only when you need to change how the AI team works.</p></div>
      </div>
      <section className="second-brain-connection" data-connected={secondBrainStatus.connected && secondBrainStatus.writable}>
        <div className="brain-connection-mark" aria-hidden="true"><i /><i /><i /></div>
        <div><span>Obsidian · Second Brain</span><strong>{secondBrainStatus.connected && secondBrainStatus.writable ? "Connected and syncing" : "Not connected"}</strong><p>{secondBrainStatus.detail}</p></div>
        <small>{secondBrainStatus.connected ? `${secondBrainStatus.projectCount} projects · ${secondBrainStatus.taskCount} requests` : "Installed app only"}</small>
      </section>
      <div className="settings-paths">
        <button type="button" onClick={onOpenAgents}><span>AI team</span><strong>Choose which model plans, builds, and tests</strong><i aria-hidden="true">→</i></button>
        <button type="button" onClick={onOpenPolicy}><span>Rules & safety</span><strong>Review approvals, permissions, and completion rules</strong><i aria-hidden="true">→</i></button>
      </div>
    </div>
  );
}

function AgentsView({ agents, providerStatus, onUpdate, onApplyRecommended }: { agents: OrchestratorState["agents"]; providerStatus: ProviderStatusResponse; onUpdate: (role: AgentRole, patch: Partial<{ provider: ProviderId; model: string }>) => void; onApplyRecommended: () => void }) {
  return (
    <div className="collection-view agent-view">
      <div className="collection-header">
        <div><p className="eyebrow">Your AI team</p><h2>Four jobs, clearly separated</h2><p>One agent plans or builds. For important work, the other company’s agent gives an independent second opinion.</p></div>
        <span className="mock-banner"><i aria-hidden="true" /> Practice mode is always available</span>
      </div>
      <div className="provider-connections" aria-label="Subscription connections">
        {[providerStatus.openai, providerStatus.anthropic].map((connection) => (
          <section key={connection.provider} data-ready={connection.subscriptionAuthenticated && connection.usage.state !== "limit_reached"}>
            <span>{connection.usage.state === "limit_reached" ? "Limit reached" : connection.subscriptionAuthenticated ? quickUsageLabel(connection) : "Not ready"}</span>
            <h3>{connection.label}</h3>
            <p>{connection.usage.state === "unknown" ? connection.detail : connection.usage.summary}</p>
          </section>
        ))}
      </div>
      <button className="team-recommendation" type="button" onClick={onApplyRecommended}>
        <span><small>Recommended setup</small><strong>Claude plans · Codex builds and tests</strong></span>
        <i>Use this setup</i>
      </button>
      <div className="agent-grid">
        {agents.map((agent, index) => (
          <section className="agent-row" key={agent.role}>
            <div className="agent-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="agent-title"><span className="agent-avatar">{roleInitials(agent.role)}</span><div><p className="section-label">{agent.role}</p><h3>{agent.name}</h3><p>{roleDescriptions[agent.role]}</p><small className="agent-recommendation">{roleRecommendations[agent.role]}</small></div></div>
            <div className="agent-controls">
              <label htmlFor={`provider-${agent.role}`}>{agent.role === "reviewer" ? "Default for small requests" : "Provider"}</label>
              <select id={`provider-${agent.role}`} value={agent.provider} onChange={(event) => onUpdate(agent.role, { provider: event.target.value as ProviderId })} aria-describedby={agent.role === "reviewer" ? "reviewer-routing-note" : undefined}>
                <option value="openai">OpenAI / Codex</option>
                <option value="anthropic">Anthropic / Claude</option>
              </select>
              {agent.role === "reviewer" && <p className="agent-control-help">Important requests ignore this default and use whichever AI did not build.</p>}
            </div>
            <p className="agent-mandate">{agent.mandate}</p>
          </section>
        ))}
      </div>
      <p id="reviewer-routing-note" className="routing-note"><strong>Why the reviewer can change automatically:</strong> Claude-built work goes to Codex for review, and Codex-built work goes to Claude. Your reviewer choice above is used only when you intentionally mark a request as small enough to skip the cross-model rule.</p>
    </div>
  );
}

function ProjectForm({ onChooseFolder, onSubmit }: { onChooseFolder: () => Promise<string | null>; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [folder, setFolder] = useState("");
  return (
    <form onSubmit={onSubmit}>
      <p className="eyebrow">New project</p><h2 id="modal-title">What are you working on?</h2><p className="modal-intro">A project keeps your requests, code folder, and important decisions together.</p>
      <label htmlFor="project-name">Project name</label><input id="project-name" name="name" required maxLength={80} placeholder="Customer portal" />
      <label htmlFor="project-description">Short description</label><textarea id="project-description" name="description" required rows={4} placeholder="What is this project meant to do?" />
      <input type="hidden" name="repositoryPath" value={folder} />
      <FolderPicker folder={folder} onChoose={async () => setFolder(await onChooseFolder() ?? folder)} />
      <button className="approve-action modal-submit" type="submit">Create project</button>
    </form>
  );
}

function StartTaskView(props: TaskComposerProps) {
  return <div className="start-task-view"><TaskComposer {...props} /></div>;
}

interface TaskComposerProps {
  projectName?: string;
  repositoryPath?: string;
  providerStatus: ProviderStatusResponse;
  onChooseFolder: () => Promise<string | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  modal?: boolean;
}

function FolderPicker({ folder, onChoose }: { folder: string; onChoose: () => void }) {
  return (
    <div className="folder-picker">
      <div><span>Your app&apos;s code folder</span><strong>{folder || "No folder chosen"}</strong><small>{folder ? "Only this folder is available to the coding agents." : "Choose the main folder for the app you want changed—the one that contains its code and .git folder. Nothing is uploaded."}</small></div>
      <button type="button" onClick={onChoose}>{folder ? "Change" : "Choose folder"}</button>
    </div>
  );
}

function TaskComposer({ projectName, repositoryPath, providerStatus, onChooseFolder, onSubmit, modal = false }: TaskComposerProps) {
  const [folder, setFolder] = useState(repositoryPath ?? "");
  const [mode, setMode] = useState<ExecutionMode>("demo");
  const subscriptionAvailable = providerStatus.desktop && [providerStatus.openai, providerStatus.anthropic]
    .some((connection) => connection.subscriptionAuthenticated && connection.usage.state !== "limit_reached");
  return (
    <form className={`task-composer ${modal ? "task-composer-modal" : ""}`} onSubmit={onSubmit}>
      <p className="eyebrow">{projectName ? `New request · ${projectName}` : "New request"}</p>
      <h2 id={modal ? "modal-title" : undefined}>What do you want to build?</h2>
      <label className="composer-label" htmlFor={modal ? "modal-task-brief" : "start-task-brief"}>Request</label>
      <textarea
        className="composer-textarea"
        id={modal ? "modal-task-brief" : "start-task-brief"}
        name="brief"
        required
        rows={modal ? 7 : 8}
        placeholder="Describe what you want changed…"
      />

      <fieldset className="mode-choice">
        <legend>Run</legend>
        <label aria-label="Show me how it works" htmlFor={modal ? "modal-mode-demo" : "start-mode-demo"} data-selected={mode === "demo"}>
          <input id={modal ? "modal-mode-demo" : "start-mode-demo"} type="radio" name="executionMode" value="demo" checked={mode === "demo"} onChange={() => setMode("demo")} />
          <span><strong>Practice</strong><small>Preview only. No AI or code changes.</small></span>
        </label>
        <label aria-label="Work on my real project" htmlFor={modal ? "modal-mode-subscription" : "start-mode-subscription"} data-selected={mode === "subscription"} data-disabled={!subscriptionAvailable}>
          <input id={modal ? "modal-mode-subscription" : "start-mode-subscription"} type="radio" name="executionMode" value="subscription" checked={mode === "subscription"} disabled={!subscriptionAvailable} onChange={() => setMode("subscription")} />
          <span><strong>Real project</strong><small>{subscriptionAvailable ? "Use the selected code folder and signed-in AI tools." : providerStatus.desktop ? "Both subscriptions are currently unavailable." : "Available in the installed Mac app."}</small></span>
        </label>
      </fieldset>

      <div className="money-clarity" data-mode={mode}>
        <strong>{mode === "demo" ? "No AI used" : "Subscription usage"}</strong>
        <p>{mode === "demo" ? "Preview only." : "No API billing."}</p>
      </div>

      <input type="hidden" name="repositoryPath" value={folder} />
      {mode === "subscription" && <FolderPicker folder={folder} onChoose={async () => setFolder(await onChooseFolder() ?? folder)} />}

      <button className="approve-action composer-submit" type="submit">Create request <span aria-hidden="true">→</span></button>
      <p className="composer-next">You approve the plan before any code changes.</p>

      <details className="composer-advanced">
        <summary>Safety controls <span>Recommended defaults</span></summary>
        {!projectName && <><label htmlFor={modal ? "modal-project-name" : "start-project-name"}>Project name</label><input id={modal ? "modal-project-name" : "start-project-name"} name="projectName" maxLength={80} placeholder="Automatically named from the folder" /></>}
        <label htmlFor={modal ? "modal-task-title" : "start-task-title"}>Short title</label><input id={modal ? "modal-task-title" : "start-task-title"} name="title" maxLength={100} placeholder="Automatically taken from your request" />
        <label htmlFor={modal ? "modal-task-importance" : "start-task-importance"}>Second opinion</label>
        <select id={modal ? "modal-task-importance" : "start-task-importance"} name="importance" defaultValue="important">
          <option value="important">Required · a different AI reviews important work</option>
          <option value="standard">Skip cross-model review for this small request</option>
        </select>
        <p className="safety-stop-note"><strong>More is not automatically better.</strong> These numbers only give a difficult job more chances to retry. Higher limits can use more of your subscription allowance.</p>
        <div className="form-grid form-grid-three safety-stop-grid">
          <div><label htmlFor={modal ? "modal-task-round-limit" : "start-task-round-limit"}>Whole workflow</label><small id={modal ? "modal-round-help" : "start-round-help"}>Maximum AI steps from planning through review. Keep 12.</small><input aria-describedby={modal ? "modal-round-help" : "start-round-help"} id={modal ? "modal-task-round-limit" : "start-task-round-limit"} name="roundLimit" type="number" min="6" max="30" defaultValue="12" required /></div>
          <div><label htmlFor={modal ? "modal-task-planning-limit" : "start-task-planning-limit"}>Plan retries</label><small id={modal ? "modal-plan-help" : "start-plan-help"}>Used only if a plan is challenged or rejected. Keep 2.</small><input aria-describedby={modal ? "modal-plan-help" : "start-plan-help"} id={modal ? "modal-task-planning-limit" : "start-task-planning-limit"} name="planningLimit" type="number" min="1" max="5" defaultValue={DEFAULT_LOOP_LIMITS.planning} required /></div>
          <div><label htmlFor={modal ? "modal-task-fix-limit" : "start-task-fix-limit"}>Fix retries</label><small id={modal ? "modal-fix-help" : "start-fix-help"}>Used only when tests or review find a problem. Keep 2.</small><input aria-describedby={modal ? "modal-fix-help" : "start-fix-help"} id={modal ? "modal-task-fix-limit" : "start-task-fix-limit"} name="fixLimit" type="number" min="1" max="5" defaultValue={DEFAULT_LOOP_LIMITS.fix} required /></div>
        </div>
        <input type="hidden" name="reviewLimit" value={DEFAULT_LOOP_LIMITS.review} />
      </details>
    </form>
  );
}

function TaskForm(props: Omit<TaskComposerProps, "modal">) {
  return <TaskComposer {...props} modal />;
}

function SettingsForm({ task, onSubmit }: { task: Task; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const counts = task.loopCounts ?? DEFAULT_LOOP_COUNTS;
  const limits = task.loopLimits ?? DEFAULT_LOOP_LIMITS;
  return (
    <form onSubmit={onSubmit}>
      <p className="eyebrow">Optional controls</p><h2 id="modal-title">Safety stops</h2><p className="modal-intro">These stop agents from talking or revising forever. They are not prices, charges, or spending limits.</p>
      <label htmlFor="settings-round-limit">Maximum agent steps</label><input id="settings-round-limit" name="roundLimit" type="number" min={task.round} max="30" defaultValue={task.roundLimit} required />
      <p className="form-help">Maximum revisions in each part of the workflow</p>
      <div className="form-grid form-grid-three">
        <div><label htmlFor="settings-planning-limit">Planning</label><input id="settings-planning-limit" name="planningLimit" type="number" min={counts.planning} max="10" defaultValue={limits.planning} required /></div>
        <div><label htmlFor="settings-review-limit">Review</label><input id="settings-review-limit" name="reviewLimit" type="number" min={counts.review} max="10" defaultValue={limits.review} required /></div>
        <div><label htmlFor="settings-fix-limit">Fix</label><input id="settings-fix-limit" name="fixLimit" type="number" min={counts.fix} max="10" defaultValue={limits.fix} required /></div>
      </div>
      <div className="settings-current"><span>Used so far</span><strong>{task.round} agent steps</strong></div>
      <button className="approve-action modal-submit" type="submit">Save safety stops</button>
    </form>
  );
}
