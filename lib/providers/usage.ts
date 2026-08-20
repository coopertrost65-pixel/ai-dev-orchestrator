import type { ProviderUsageSnapshot, ProviderUsageState, ProviderUsageWindow } from "./types";

export interface RawCodexRateLimitWindow {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

export interface RawCodexRateLimitSnapshot {
  primary?: RawCodexRateLimitWindow | null;
  secondary?: RawCodexRateLimitWindow | null;
  credits?: { hasCredits?: boolean; balance?: string | number | null } | null;
  rateLimitReachedType?: string | null;
  spendControlReached?: boolean | null;
}

export interface RawClaudeRateLimitInfo {
  status?: "allowed" | "allowed_warning" | "rejected" | string;
  resetsAt?: number | null;
  rateLimitType?: string | null;
  // Claude Code's rate_limit_event carries status/resetsAt/rateLimitType only.
  // It never includes a numeric utilization — kept here in case that changes.
  utilization?: number | null;
}

export function emptyUsage(summary: string): ProviderUsageSnapshot {
  return {
    state: "unknown",
    summary,
    windows: [],
    checkedAt: new Date().toISOString(),
    source: "unavailable",
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stateFromWindows(windows: ProviderUsageWindow[], rejected = false): ProviderUsageState {
  if (rejected || windows.some((window) => (window.usedPercent ?? 0) >= 100)) return "limit_reached";
  if (windows.some((window) => (window.usedPercent ?? 0) >= 85)) return "near_limit";
  return windows.length ? "available" : "unknown";
}

function codexWindowLabel(durationMinutes?: number | null): string {
  if (durationMinutes === 300) return "5-hour allowance";
  if (durationMinutes === 10_080) return "Weekly allowance";
  if (!durationMinutes) return "Included allowance";
  if (durationMinutes % 1_440 === 0) return `${durationMinutes / 1_440}-day allowance`;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}-hour allowance`;
  return "Included allowance";
}

export function normalizeCodexUsage(raw: RawCodexRateLimitSnapshot, checkedAt = new Date().toISOString()): ProviderUsageSnapshot {
  const windows = [raw.primary, raw.secondary]
    .filter((window): window is RawCodexRateLimitWindow => Boolean(window && typeof window.usedPercent === "number"))
    .map((window, index): ProviderUsageWindow => ({
      id: index === 0 ? "primary" : "secondary",
      label: codexWindowLabel(window.windowDurationMins),
      usedPercent: clampPercent(window.usedPercent ?? 0),
      resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : undefined,
    }));
  const rejected = Boolean(raw.rateLimitReachedType || raw.spendControlReached);
  const state = stateFromWindows(windows, rejected);
  const mostUsed = windows.reduce<ProviderUsageWindow | undefined>((current, window) => (
    !current || (window.usedPercent ?? 0) > (current.usedPercent ?? 0) ? window : current
  ), undefined);
  const summary = state === "limit_reached"
    ? "Codex has reached an included usage limit."
    : state === "near_limit"
      ? `${mostUsed?.usedPercent ?? 0}% of the current Codex allowance is used.`
      : state === "available"
        ? `${100 - (mostUsed?.usedPercent ?? 0)}% of the current Codex allowance remains.`
        : "Codex is connected, but its usage percentage is unavailable.";

  return {
    state,
    summary,
    windows,
    checkedAt,
    source: "live",
    credits: raw.credits
      ? { balance: String(raw.credits.balance ?? "0"), available: Boolean(raw.credits.hasCredits) }
      : undefined,
  };
}

function claudeWindowLabel(type?: string | null): string {
  if (type === "five_hour") return "5-hour allowance";
  if (type === "seven_day") return "Weekly allowance";
  if (type === "seven_day_opus") return "Weekly Opus allowance";
  if (type === "seven_day_sonnet") return "Weekly Sonnet allowance";
  if (type === "overage") return "Extra usage";
  return "Subscription allowance";
}

export function normalizeClaudeUsage(events: RawClaudeRateLimitInfo[], checkedAt = new Date().toISOString()): ProviderUsageSnapshot {
  const byType = new Map<string, ProviderUsageWindow>();
  let rejected = false;
  let warned = false;
  for (const event of events) {
    if (event.status === "rejected") rejected = true;
    if (event.status === "allowed_warning") warned = true;
    const id = event.rateLimitType || `window-${byType.size + 1}`;
    byType.set(id, {
      id,
      label: claudeWindowLabel(event.rateLimitType),
      usedPercent: typeof event.utilization === "number" ? clampPercent(event.utilization * 100) : undefined,
      resetsAt: typeof event.resetsAt === "number" ? event.resetsAt : undefined,
    });
  }
  const windows = [...byType.values()];
  let state = stateFromWindows(windows, rejected);
  if (warned && state !== "limit_reached") state = "near_limit";
  const mostUsed = windows.reduce<ProviderUsageWindow | undefined>((current, window) => (
    typeof window.usedPercent === "number" && (!current || window.usedPercent > (current.usedPercent ?? -1)) ? window : current
  ), undefined);
  const nextReset = windows.reduce<number | undefined>((soonest, window) => (
    typeof window.resetsAt === "number" && (soonest === undefined || window.resetsAt < soonest) ? window.resetsAt : soonest
  ), undefined);
  const resetNote = nextReset ? ` Resets ${new Date(nextReset * 1000).toLocaleString()}.` : "";
  return {
    state,
    // Claude Code never reports a numeric percentage outside its interactive
    // /usage screen, so this stays status-based instead of guessing a number.
    summary: state === "limit_reached"
      ? `Claude has reached a subscription usage limit.${resetNote}`
      : state === "near_limit"
        ? typeof mostUsed?.usedPercent === "number"
          ? `${mostUsed.usedPercent}% of the current Claude allowance is used.`
          : `Claude is close to a usage limit.${resetNote}`
        : state === "available"
          ? typeof mostUsed?.usedPercent === "number"
            ? `${100 - mostUsed.usedPercent}% of the current Claude allowance remains.`
            : `Claude is connected and within its usage limits.${resetNote}`
          : "Claude is connected. Exact usage will appear after its next task step.",
    windows,
    checkedAt,
    source: events.length ? "last_run" : "unavailable",
  };
}

const CLAUDE_SESSION_LINE = /^Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/;
const CLAUDE_WEEK_LINE = /^Current week \(([^)]+)\):\s*(\d+)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/;

/**
 * Claude Code's `/usage` command is answered by the client itself rather than
 * by the model, so it costs nothing and still reports exact percentages. This
 * turns that report into the same shape Codex usage produces.
 *
 * Returns null when the report contains no allowance lines at all (for example
 * on API-key billing, where no subscription allowance exists), so the caller can
 * fall back rather than present an empty reading as fact.
 */
export function parseClaudeUsageReport(report: string, checkedAt = new Date().toISOString()): ProviderUsageSnapshot | null {
  const windows: ProviderUsageWindow[] = [];
  for (const rawLine of report.split("\n")) {
    const line = rawLine.trim();
    const session = CLAUDE_SESSION_LINE.exec(line);
    if (session) {
      windows.push({
        id: "session",
        label: "Current session",
        usedPercent: clampPercent(Number(session[1])),
        resetsLabel: session[2]?.trim() || undefined,
      });
      continue;
    }
    const week = CLAUDE_WEEK_LINE.exec(line);
    if (week) {
      windows.push({
        id: `week-${week[1].trim().toLowerCase().replace(/\s+/g, "-")}`,
        label: `Current week (${week[1].trim()})`,
        usedPercent: clampPercent(Number(week[2])),
        resetsLabel: week[3]?.trim() || undefined,
      });
    }
  }
  if (!windows.length) return null;
  const state = stateFromWindows(windows);
  const mostUsed = windows.reduce<ProviderUsageWindow | undefined>((current, window) => (
    !current || (window.usedPercent ?? 0) > (current.usedPercent ?? 0) ? window : current
  ), undefined);
  const used = mostUsed?.usedPercent ?? 0;
  return {
    state,
    summary: state === "limit_reached"
      ? "Claude has reached a subscription usage limit."
      : state === "near_limit"
        ? `${used}% of the current Claude allowance is used.`
        : `${100 - used}% of the current Claude allowance remains.`,
    windows,
    checkedAt,
    source: "live",
  };
}

/**
 * A window that has passed its reset time no longer describes the current
 * allowance. Claude reports limits only during a live call, so rather than
 * showing a stale "limit reached" indefinitely, expire the window for free
 * once the clock says it rolled over.
 */
export function applyClaudeWindowReset(usage: ProviderUsageSnapshot, now = Date.now()): ProviderUsageSnapshot {
  if (!usage.windows.length) return usage;
  const seconds = Math.floor(now / 1000);
  const live = usage.windows.filter((window) => typeof window.resetsAt !== "number" || window.resetsAt > seconds);
  if (live.length === usage.windows.length) return usage;
  if (!live.length) {
    return {
      state: "unknown",
      summary: "Claude's usage window has reset since the last reading.",
      windows: [],
      checkedAt: usage.checkedAt,
      source: usage.source,
    };
  }
  return { ...usage, windows: live, state: stateFromWindows(live) };
}

export function limitErrorUsage(message: string, checkedAt = new Date().toISOString()): ProviderUsageSnapshot | null {
  const lower = message.toLowerCase();
  const isLimit = ["usage limit", "session limit", "weekly limit", "rate limit reached", "usage_limit_exceeded"]
    .some((phrase) => lower.includes(phrase));
  if (!isLimit) return null;
  const time = message.match(/resets?\s+(?:at\s+)?([^\n.]+)/i)?.[1]?.trim();
  return {
    state: "limit_reached",
    summary: time ? `Usage limit reached. Provider says it resets ${time}.` : "Usage limit reached. Wait for the provider reset before retrying.",
    windows: [],
    checkedAt,
    source: "last_run",
  };
}
