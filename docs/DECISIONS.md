# Decisions

## ADR-001 — Use a deterministic state machine

Status: Accepted · 2026-08-19

The protocol is encoded as nine ordered internal states. Explicit transitions are easier to test and audit than free-form agent-to-agent conversation.

## ADR-002 — Keep provider adapters provider-neutral

Status: Accepted · 2026-08-19

Every provider implements the same request and response contract. Vendor payloads and SDK types stay at the server integration edge so projects, tasks, approvals, and handoffs remain portable.

## ADR-003 — Keep a no-model Practice mode

Status: Accepted · 2026-08-19

The complete UI and workflow must work without a provider connection. Deterministic practice outputs make onboarding and state-machine tests repeatable, and they never change code.

## ADR-004 — Require two explicit human gates

Status: Accepted · 2026-08-19

Implementation is blocked until plan approval. Fix work is blocked until the user accepts final review findings. This keeps a person responsible for scope and remediation decisions.

## ADR-005 — Use D1 for v1 persistence

Status: Accepted · 2026-08-19

Product state should survive sessions and should not use browser storage as its authority. V1 stores one versioned JSON aggregate in D1 to minimize schema overhead. Normalized tables remain the preferred direction when multi-user querying is added.

## ADR-006 — Use subscription authentication only

Status: Accepted · 2026-08-19

Subscription adapters post to dedicated private desktop endpoints. The server confirms ChatGPT or Claude subscription authentication and strips API-key variables. A run fails rather than falling back to usage-based API billing.

## ADR-007 — Do not deploy v1 from this task

Status: Accepted · 2026-08-19

The requested deliverable is a validated local app. No hosted resources or production secrets are created.

## ADR-008 — Require adversarial cross-model review for important work

Status: Accepted · 2026-08-19

The provider that built important work cannot review it. Anthropic-built work routes to OpenAI review; OpenAI/Codex-built work routes to Anthropic review. Reviewers challenge claims and may reject conclusions with evidence.

## ADR-009 — Preserve disagreements and bound reconciliation

Status: Accepted · 2026-08-19

Material disagreements retain both provider positions. The default reconciliation budget is one round. If disagreement remains, the user decides and the resolution is recorded; models cannot converse indefinitely.

## ADR-010 — Separate permissions from provider capability

Status: Accepted · 2026-08-19

Plan, Build, Review, Debug, and Ship modes determine allowed behavior. Reading and testing are automatic. Installs, migrations, deletion, repository writes, and production deploys require approval. Secrets are manual-only. A model response never grants a repository permission.

## ADR-011 — Compute completion from evidence

Status: Accepted · 2026-08-19

Done requires verification evidence, independent review, accepted approvals, and no open disagreement. Each task also has finite planning, review, fix, total-step, and reconciliation safety stops. These limits do not represent money.

## ADR-015 — Make task intake paste-first

Status: Accepted · 2026-08-19

The first screen is one large request composer. Users may paste an entire conversation or rough idea without naming a task or configuring review loops. Titles are inferred, important cross-model review is the default, and technical stop rules remain optional Advanced controls.

## ADR-016 — Authorize one exact local project folder

Status: Accepted · 2026-08-19

The desktop folder picker records explicit access to one resolved path. Subscription execution rejects unapproved paths and requires a Git repository. Planning/review use read-only mode; approved Build/Debug phases use workspace-limited editing.

## ADR-012 — Keep source and packaging provider-neutral

Status: Accepted · 2026-08-19

The local TypeScript repository is portable between coding tools. Claude, Codex, or another editor can maintain it. A desktop wrapper does not bind ownership to the provider that built it, and live API providers remain independently configurable.

## ADR-013 — Package a private loopback-only Mac app

Status: Accepted · 2026-08-19

Electron packages the existing interface as a normal macOS application. It launches a standalone local server on an available `127.0.0.1` port, opens only that origin in a sandboxed window, denies web permissions by default, and terminates the server when the app closes. No deployment is involved.

## ADR-014 — Keep desktop state in Application Support

Status: Accepted · 2026-08-19

The desktop server writes the shared versioned state aggregate atomically beneath the current macOS user's Application Support directory. The application bundle remains read-only and movable, while the web runtime continues to use D1.

## ADR-017 — Show only provider-confirmed usage

Status: Accepted · 2026-08-19

Codex usage comes from its official local app-server rate-limit endpoint. Claude Code exposes plan status interactively through `/usage`, but not as a safe standalone machine-readable query. The app therefore records Claude percentages only from rate-limit events or limit errors returned by a real Claude run and directs the user to `/usage` or Claude’s official Usage page between runs. The UI never estimates a percentage. Optional paid credits are displayed separately from included subscription allowance.

## ADR-018 — Preserve independent review during provider exhaustion

Status: Accepted · 2026-08-19

If a provider reports a reached limit, ordinary phases may use the other authenticated provider. An important review cannot fall back to the builder's provider; it pauses until the independent provider resets or the user changes the task's importance. The app never purchases usage or switches to API billing automatically.

## ADR-019 — Update the installed app in place

Status: Accepted · 2026-08-19

Desktop updates preserve the existing outer `/Applications/AI Dev Orchestrator.app` directory and synchronize a verified package into it. The bundle identifier and path remain stable, stale signed resources are removed, and the build number advances. This prevents normal development updates from detaching the user's existing Dock item.

## ADR-020 — Maintain one reusable icon source

Status: Accepted · 2026-08-19

The app icon follows the sibling-app rule: a full-bleed dark-indigo field, cream primary mark, and one indigo-violet accent. The selected mark is a single geometric `A` with a violet curved crossbar, chosen for a strong silhouette and clear Dock-size legibility without explanatory diagrams. The browser favicon and in-app wordmark use the same mark. One SVG source deterministically generates the master PNG, complete macOS iconset, and ICNS package so the Dock, Finder, releases, and future marketing assets do not drift.

## ADR-021 — Give desktop launch one branded opening sequence

Status: Accepted · 2026-08-19

Each application mount begins with a 2.4-second full-window sequence that draws the selected `A`, sweeps in its violet crossbar, holds the product name, and reveals the ready workspace. It uses CSS and inline SVG only, blocks accidental interaction during launch, and disappears entirely for people who prefer reduced motion.

## ADR-022 — Keep retries conservative and explain them as safety stops

Status: Accepted · 2026-08-19

The default workflow remains 12 total agent steps with two planning retries and two fix retries. Higher values do not imply higher quality; they only permit more attempts and can consume more subscription allowance. The request composer presents these as optional safety stops, recommends the defaults, and explains each value in plain language.

## ADR-023 — Require fresh verification and review after every fix

Status: Accepted · 2026-08-20

A fix cannot transition directly to Done. It returns to Verify and then Code review. Verification and review expose explicit outcomes and blocking findings; non-empty evidence text alone never counts as a pass. Only an accepted passing review newer than the latest code change may finish a task.

## ADR-024 — Make reconciliation a real bounded provider step

Status: Accepted · 2026-08-20

The reconciliation control invokes one provider with both preserved positions and consumes one agent step. A deterministic hard-coded sentence is not a reconciliation. If the provider cannot support a resolution, the disagreement remains open for the user to decide.

## ADR-025 — Stop before risky actions and record exact decisions

Status: Accepted · 2026-08-20

Provider output may request an exact risky action, command, and target. The task blocks until the user approves or denies that request. Secret modification remains manual-only. Approved and denied requests remain in the audit trail and are included in the next provider handoff.

## ADR-026 — Recommend complementary defaults without locking the reviewer

Status: Accepted · 2026-08-20

The default team uses Claude for architecture and Codex for implementation and testing. The reviewer provider remains user-selectable as the default for standard requests. Important requests override that default and automatically route review to the provider opposite the actual architect or implementer so a builder never reviews its own work.

## ADR-027 — Connect through ChatGPT Memory and preserve Claude Memory ownership

Status: Accepted · 2026-08-20

Second Brain is the broader cross-project memory layer. AI Dev Orchestrator publishes structured, secret-redacted project snapshots to `ChatGPT Memory/AI Dev Orchestrator`, which the existing Second Brain build already imports. It never directly writes Claude Memory, preserving the established “Codex reads, Claude writes” rule. Real providers receive at most five relevant memory excerpts, treated as untrusted reference data rather than instructions. Raw chats, hidden reasoning, credentials, token counts, and cost estimates are excluded.
