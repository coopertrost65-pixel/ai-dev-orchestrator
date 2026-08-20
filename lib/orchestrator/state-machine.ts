import type { ApprovalGate, Task, WorkflowDefinition, WorkflowPhase } from "../domain/types";
import { getLoopBlock } from "./policy.ts";

export const WORKFLOW: readonly WorkflowDefinition[] = [
  { id: "explore", label: "Understand the project", shortLabel: "Understand", role: "architect", description: "Read the request and inspect the project before deciding what to change." },
  { id: "plan", label: "Make a plan", shortLabel: "Plan", role: "architect", description: "Turn the request into a clear, bounded build plan." },
  { id: "plan_review", label: "Check the plan", shortLabel: "2nd opinion", role: "reviewer", description: "A different agent challenges the plan before work begins." },
  { id: "approve", label: "Your approval", shortLabel: "You approve", role: "human", description: "You approve the plan or ask for a change." },
  { id: "implement", label: "Build it", shortLabel: "Build", role: "implementer", description: "Make the code changes allowed by the approved plan." },
  { id: "verify", label: "Test it", shortLabel: "Test", role: "tester", description: "Run checks and capture evidence that the result works." },
  { id: "code_review", label: "Review the result", shortLabel: "2nd opinion", role: "reviewer", description: "A different agent reviews the implementation and test evidence." },
  { id: "fix", label: "Improve it", shortLabel: "Improve", role: "implementer", description: "Resolve the review findings you accepted." },
  { id: "done", label: "Finished", shortLabel: "Finished", role: "system", description: "The task passed the required checks and reviews." },
] as const;

export function getPhaseDefinition(phase: WorkflowPhase): WorkflowDefinition {
  const definition = WORKFLOW.find((item) => item.id === phase);
  if (!definition) throw new Error(`Unknown workflow phase: ${phase}`);
  return definition;
}

export function getPhaseIndex(phase: WorkflowPhase): number {
  return WORKFLOW.findIndex((item) => item.id === phase);
}

export function getNextPhase(phase: WorkflowPhase): WorkflowPhase {
  const index = getPhaseIndex(phase);
  if (index < 0 || index === WORKFLOW.length - 1) return "done";
  return WORKFLOW[index + 1].id;
}

export function getExecutionBlock(task: Task): string | null {
  if (task.phase === "done") return "This task is already complete.";
  if (task.status === "paused") return "Resume the task before running another phase.";
  if (task.pendingApproval) return "Resolve the approval gate before running another agent.";
  if (task.round >= task.roundLimit) return `Safety stop reached after ${task.roundLimit} agent steps. Increase it under Advanced controls to continue.`;
  const loopBlock = getLoopBlock(task);
  if (loopBlock) return loopBlock;
  return null;
}

export function phaseAfterExecution(phase: WorkflowPhase): { phase: WorkflowPhase; gate: ApprovalGate | null } {
  if (phase === "plan_review") return { phase: "approve", gate: "plan" };
  if (phase === "code_review") return { phase: "code_review", gate: "findings" };
  if (phase === "fix") return { phase: "verify", gate: null };
  return { phase: getNextPhase(phase), gate: null };
}

export function phaseAfterApproval(gate: ApprovalGate, reviewOutcome: Task["handoffs"][number]["outcome"] = "changes_required"): WorkflowPhase {
  if (gate === "plan") return "implement";
  return reviewOutcome === "passed" ? "done" : "fix";
}

export function progressPercent(phase: WorkflowPhase): number {
  const index = getPhaseIndex(phase);
  return Math.round((Math.max(0, index) / (WORKFLOW.length - 1)) * 100);
}
