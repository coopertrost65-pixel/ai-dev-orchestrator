import assert from "node:assert/strict";
import test from "node:test";
import { applyClaudeWindowReset, limitErrorUsage, normalizeClaudeUsage, normalizeCodexUsage, parseClaudeUsageReport } from "../lib/providers/usage.ts";

test("Codex usage distinguishes included allowance from paid credits", () => {
  const usage = normalizeCodexUsage({
    primary: { usedPercent: 31, windowDurationMins: 10_080, resetsAt: 1_787_333_354 },
    secondary: null,
    credits: { hasCredits: false, balance: "0" },
    rateLimitReachedType: null,
  }, "2026-08-19T00:00:00.000Z");

  assert.equal(usage.state, "available");
  assert.equal(usage.summary, "69% of the current Codex allowance remains.");
  assert.equal(usage.windows[0]?.label, "Weekly allowance");
  assert.deepEqual(usage.credits, { balance: "0", available: false });
});

test("Claude rate-limit events become truthful usage windows", () => {
  const usage = normalizeClaudeUsage([
    { status: "allowed", rateLimitType: "five_hour", utilization: 0.62, resetsAt: 1_787_333_354 },
    { status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.88, resetsAt: 1_787_800_000 },
  ], "2026-08-19T00:00:00.000Z");

  assert.equal(usage.state, "near_limit");
  assert.equal(usage.windows[0]?.usedPercent, 62);
  assert.equal(usage.windows[1]?.label, "Weekly allowance");
});

test("Claude Code's real rate_limit_event has no numeric utilization, but still produces a status", () => {
  // This is the actual shape Claude Code emits (status/resetsAt/rateLimitType only —
  // no percentage). Feeding it fake `utilization` in tests masked a bug where every
  // event was silently dropped and the usage card never left "not shared yet".
  const usage = normalizeClaudeUsage([
    { status: "allowed", resetsAt: 1_787_248_800, rateLimitType: "five_hour" },
  ], "2026-08-19T00:00:00.000Z");

  assert.equal(usage.state, "available");
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0]?.usedPercent, undefined);
  assert.match(usage.summary, /^Claude is connected and within its usage limits\. Resets .+\.$/);
});

test("a rejected status without a percentage still reports the limit as reached", () => {
  const usage = normalizeClaudeUsage([
    { status: "rejected", resetsAt: 1_787_248_800, rateLimitType: "five_hour" },
  ], "2026-08-19T00:00:00.000Z");

  assert.equal(usage.state, "limit_reached");
});

test("Claude's own usage report yields exact percentages at no cost", () => {
  // Verbatim shape of `claude -p "/usage"`, which the client answers itself.
  const usage = parseClaudeUsageReport([
    "You are currently using your subscription to power your Claude Code usage",
    "",
    "Current session: 37% used · resets Aug 20 at 10:59am (America/Los_Angeles)",
    "Current week (all models): 35% used · resets Aug 24 at 10:59am (America/Los_Angeles)",
    "Current week (Fable): 0% used",
    "",
    "What's contributing to your limits usage?",
    "Last 24h · 4015 requests · 6 sessions",
    "  97% of your usage was at >150k context",
  ].join("\n"), "2026-08-20T00:00:00.000Z");

  assert.equal(usage?.state, "available");
  assert.equal(usage?.source, "live");
  assert.equal(usage?.summary, "63% of the current Claude allowance remains.");
  assert.equal(usage?.windows.length, 3);
  assert.equal(usage?.windows[0]?.usedPercent, 37);
  assert.equal(usage?.windows[0]?.resetsLabel, "Aug 20 at 10:59am (America/Los_Angeles)");
  assert.equal(usage?.windows[1]?.label, "Current week (all models)");
  assert.equal(usage?.windows[2]?.usedPercent, 0);
  // The diagnostic percentages further down the report must not become windows.
  assert.ok(!usage?.windows.some((window) => window.label.includes("context")));
});

test("a maxed-out allowance reads as limit reached, and no allowance reads as null", () => {
  const maxed = parseClaudeUsageReport("Current session: 100% used · resets Aug 20 at 10:59am", "2026-08-20T00:00:00.000Z");
  assert.equal(maxed?.state, "limit_reached");

  const near = parseClaudeUsageReport("Current week (all models): 91% used", "2026-08-20T00:00:00.000Z");
  assert.equal(near?.state, "near_limit");

  // API-key billing reports no allowance at all; that must not look like 0% used.
  assert.equal(parseClaudeUsageReport("You are using a Claude API key", "2026-08-20T00:00:00.000Z"), null);
});

test("a passed reset time expires a stale limit for free, without a live call", () => {
  const reached = normalizeClaudeUsage([
    { status: "rejected", rateLimitType: "five_hour", resetsAt: 1_787_248_800 },
  ], "2026-08-19T00:00:00.000Z");
  assert.equal(reached.state, "limit_reached");

  // One second before the reset the block still stands.
  assert.equal(applyClaudeWindowReset(reached, 1_787_248_799_000).state, "limit_reached");

  // One second after it, the window has rolled over and must stop claiming a block.
  const after = applyClaudeWindowReset(reached, 1_787_248_801_000);
  assert.equal(after.state, "unknown");
  assert.equal(after.windows.length, 0);
});

test("window reset only drops the windows that actually expired", () => {
  const usage = normalizeClaudeUsage([
    { status: "rejected", rateLimitType: "five_hour", resetsAt: 1_787_248_800 },
    { status: "allowed", rateLimitType: "seven_day", resetsAt: 1_787_800_000 },
  ], "2026-08-19T00:00:00.000Z");

  const after = applyClaudeWindowReset(usage, 1_787_248_801_000);
  assert.equal(after.windows.length, 1);
  assert.equal(after.windows[0]?.label, "Weekly allowance");
  assert.equal(after.state, "available");
});

test("provider limit messages block work and preserve reset guidance", () => {
  const usage = limitErrorUsage("You've hit your weekly limit · resets Mon 12:00am");
  assert.equal(usage?.state, "limit_reached");
  assert.match(usage?.summary ?? "", /Mon 12:00am/);
  assert.equal(limitErrorUsage("Temporary network failure"), null);
});
