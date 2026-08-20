export const WORKFLOW_PHASE_IDS = [
  "explore",
  "plan",
  "plan_review",
  "approve",
  "implement",
  "verify",
  "code_review",
  "fix",
  "done",
] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASE_IDS)[number];
export type AgentRole = "architect" | "implementer" | "reviewer" | "tester";
export type ProviderId = "openai" | "anthropic";
export type ApprovalGate = "plan" | "findings";
export type OperatingMode = "plan" | "build" | "review" | "debug" | "ship";
export type TaskImportance = "standard" | "important";
export type ExecutionMode = "demo" | "subscription";
export type LoopKind = "planning" | "review" | "fix";
export type ReviewStance = "independent" | "agree" | "challenge" | "reject";
export type HandoffOutcome = "informational" | "passed" | "changes_required" | "blocked";
export type PermissionAction = "install_packages" | "database_migration" | "delete_files" | "git_write" | "production_deploy" | "modify_secrets";

export interface LoopBudget {
  planning: number;
  review: number;
  fix: number;
}

export interface DisagreementRecord {
  status: "none" | "open" | "reconciled" | "decided";
  summary: string;
  arguments?: Array<{ provider: ProviderId; position: string }>;
  resolution?: string;
}

export interface DocumentationUpdate {
  path: "docs/PRODUCT.md" | "docs/ARCHITECTURE.md" | "docs/DECISIONS.md";
  summary: string;
  content: string;
}

export interface PermissionRequest {
  id: string;
  action: PermissionAction;
  summary: string;
  command?: string;
  targets: string[];
  status: "pending" | "approved" | "denied";
  createdAt: string;
}

export interface DefinitionOfDoneChecks {
  verificationPassed: boolean;
  independentReviewPassed: boolean;
  approvalsCleared: boolean;
  noOpenDisagreement: boolean;
}

export interface WorkflowDefinition {
  id: WorkflowPhase;
  label: string;
  shortLabel: string;
  role: AgentRole | "human" | "system";
  description: string;
}

export interface AgentConfig {
  role: AgentRole;
  name: string;
  provider: ProviderId;
  model: string;
  mandate: string;
}

export interface ProjectDoc {
  id: string;
  path: string;
  title: string;
  description: string;
  content: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  docs: ProjectDoc[];
  repositoryPath?: string;
}

export interface HandoffMessage {
  id: string;
  phase: WorkflowPhase;
  fromRole: AgentRole;
  toRole: AgentRole | "human" | "system";
  provider: ProviderId;
  agentName: string;
  summary: string;
  details: string[];
  evidence: string[];
  risks: string[];
  stance?: ReviewStance;
  challenges?: string[];
  outcome: HandoffOutcome;
  blockingFindings: string[];
  disagreement?: DisagreementRecord;
  documentationUpdates: DocumentationUpdate[];
  permissionRequests: PermissionRequest[];
  builderProvider?: ProviderId;
  nextAction: string;
  decision: "proposed" | "accepted" | "changes_requested";
  createdAt: string;
  estimatedCost: number;
  tokens: number;
}

export interface ActivityItem {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  brief: string;
  phase: WorkflowPhase;
  status: "active" | "paused" | "blocked" | "done";
  round: number;
  roundLimit: number;
  cost: number;
  costLimit: number;
  pendingApproval: ApprovalGate | null;
  importance?: TaskImportance;
  executionMode?: ExecutionMode;
  loopCounts?: LoopBudget;
  loopLimits?: LoopBudget;
  reconciliationCount?: number;
  reconciliationLimit?: number;
  doneChecks?: DefinitionOfDoneChecks;
  permissionRequests?: PermissionRequest[];
  handoffs: HandoffMessage[];
  activity: ActivityItem[];
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorState {
  version: 1;
  projects: Project[];
  tasks: Task[];
  agents: AgentConfig[];
  activeProjectId: string;
  activeTaskId: string;
}
