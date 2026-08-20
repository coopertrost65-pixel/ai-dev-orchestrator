export interface MemoryContextItem {
  source: "claude_memory" | "chatgpt_memory";
  path: string;
  excerpt: string;
}

export interface SecondBrainStatus {
  connected: boolean;
  writable: boolean;
  detail: string;
  lastSyncedAt?: string;
  projectCount: number;
  taskCount: number;
}
