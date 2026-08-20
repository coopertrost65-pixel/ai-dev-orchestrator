import type { AgentConfig, AgentRole, DisagreementRecord, DocumentationUpdate, HandoffOutcome, PermissionAction, PermissionRequest, Project, ProjectDoc, ProviderId, ReviewStance, Task, WorkflowPhase } from "../domain/types";
import type { MemoryContextItem } from "../memory/types";

export interface ProviderRequest {
  task: Task;
  phase: WorkflowPhase;
  agent: AgentConfig;
  toRole: AgentRole | "human" | "system";
  docs: ProjectDoc[];
  project: Project;
  builderProvider?: ProviderId;
  crossModelReview: boolean;
  reconciliation?: DisagreementRecord;
  permissionDecisions?: PermissionRequest[];
  memoryContext?: MemoryContextItem[];
}

export interface PermissionProposal {
  action: PermissionAction;
  summary: string;
  command?: string;
  targets: string[];
}

export interface ProviderResponse {
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
  permissionRequests: PermissionProposal[];
  nextAction: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: "mock" | "subscription";
  run(request: ProviderRequest): Promise<ProviderResponse>;
}

export type ProviderUsageState = "available" | "near_limit" | "limit_reached" | "unknown";

export interface ProviderUsageWindow {
  id: string;
  label: string;
  usedPercent?: number;
  resetsAt?: number;
  /** Reset time exactly as the provider worded it, when it reports text rather than a timestamp. */
  resetsLabel?: string;
}

export interface ProviderUsageSnapshot {
  state: ProviderUsageState;
  summary: string;
  windows: ProviderUsageWindow[];
  checkedAt: string;
  source: "live" | "last_run" | "unavailable";
  credits?: {
    balance: string;
    available: boolean;
  };
}

export interface ProviderConnection {
  provider: ProviderId;
  available: boolean;
  subscriptionAuthenticated: boolean;
  label: string;
  detail: string;
  usage: ProviderUsageSnapshot;
}

export interface ProviderStatusResponse {
  desktop: boolean;
  openai: ProviderConnection;
  anthropic: ProviderConnection;
}
