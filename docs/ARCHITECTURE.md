# Architecture

## Stack

- TypeScript
- React 19 with a Next.js-compatible App Router surface
- vinext and Vite for the local/runtime build
- Cloudflare Worker-compatible server output
- D1/SQLite for durable application state
- Electron shell for the private macOS application
- Plain CSS tokens and responsive layouts

## System boundaries

```text
Browser UI
  ├─ project, task, docs, roles, approvals, policy
  └─ orchestration actions
          │
          ▼
Provider-neutral domain
  ├─ deterministic state machine
  ├─ mode, routing, permission, and completion policy
  ├─ total and per-loop limit enforcement
  └─ structured handoff contract
          │
          ├─ Practice OpenAI adapter
          ├─ Practice Anthropic adapter
          ├─ Codex subscription adapter ──► server-only route ──► local Codex CLI
          └─ Claude subscription adapter ► server-only route ──► local Claude Code CLI

Browser UI ──► /api/state ──► D1 app_state record

Desktop /api/state save ──► ChatGPT Memory/AI Dev Orchestrator
                                      │
                                      └─► existing Second Brain hourly import

Claude Memory + ChatGPT Memory ──► task-relevant retrieval ──► real provider prompt
```

## Frontend

`components/orchestrator-app.tsx` owns the interactive v1 workspace. It renders six product views:

- Build: paste-first task creation, current step, disagreements, approvals, handoffs, safety stops, definition of done, and activity.
- Requests: the project queue and progress summary.
- Docs: editable shared project context.
- Agents: role, provider, and automatic opposite-builder review routing.
- Usage: live or last-confirmed subscription allowance, reset guidance, and provider fallback state.
- Policy: core requirements, permissions, modes, repository-tool roadmap, and the definition of done.

State updates are immutable and persisted through `/api/state` after a short debounce. The UI retains the seeded state if storage is unavailable and labels that condition as session mode.

## Domain

`lib/domain/types.ts` defines the durable provider-neutral records. `lib/orchestrator/state-machine.ts` owns phase ordering and transitions. `lib/orchestrator/policy.ts` owns operating modes, cross-model routing, permission declarations, finite loop ceilings, and completion checks.

The duplicate human label “Review” is represented by two unambiguous internal states:

- `plan_review`
- `code_review`

This prevents ambiguous transitions while preserving the user-facing protocol.

The nine visible states support a correction loop without adding another user-facing stage: a blocking code review advances to `fix`, and `fix` always returns to `verify` followed by a new `code_review`. A passing accepted review is the only transition to `done`.

For important tasks, plan review derives its provider from the architect and code review derives its provider from the implementer. The result is always the opposite provider family. Standard tasks may use the configured reviewer to avoid unnecessary second-model calls.

## Providers

`lib/providers/types.ts` defines one `ProviderAdapter` interface. Practice and subscription adapters return the same normalized response. The UI selects the adapter from the task's explicit execution mode.

Subscription integration:

- `lib/providers/openai.ts` posts to `/api/providers/openai`.
- `lib/providers/anthropic.ts` posts to `/api/providers/anthropic`.

Both routes are present. `lib/server/subscription-providers.ts` confirms subscription authentication, removes API-key and alternate-billing environment variables, validates a folder chosen through the desktop permission picker, selects a read-only or workspace-write sandbox from the workflow phase, requests structured output, and applies a finite timeout. A failed subscription check stops the run; there is no API-key fallback.

The same server boundary reads Codex's official app-server rate-limit snapshot and caches provider usage beneath Application Support. Claude Code offers an interactive `/usage` view but no safe standalone machine-readable remaining-quota query, so the app updates Claude's exact meter only from rate-limit events returned by a real Claude run. Limit errors are persisted with reset guidance. The UI labels each value as live, last-run, or unavailable, links to the provider view, and never fabricates a percentage.

When a known limit is reached, normal work may route to another authenticated provider. Important plan or code review pauses if the only alternative is the builder, preserving independent review.

## Repository tools

Subscription providers can read, search, edit in approved Build/Debug phases, run existing commands and tests, and inspect git diff inside one authorized Git project. Package installs, migrations, deletion, branches, commits, deployment, and secret changes remain prohibited. Pull-request support follows later.

## Desktop boundary and source ownership

The application source is standard local TypeScript and is not owned by either model provider. Codex, Claude Code, or another capable editor can work on the same repository.

The Electron shell launches the standalone production server on an ephemeral loopback-only port, waits for it to become ready, and opens it in a sandboxed desktop window. External links leave the app, browser permissions are denied by default, and closing the app stops the private server. The packaged application writes state and logs only under the macOS Application Support directory, never inside the application bundle.

Desktop packaging uses the stable bundle identifier `app.aidevorchestrator.desktop`. The updater verifies the packaged signature and installed identifier, closes a running copy, then synchronizes signed contents with deletion of stale resources while preserving the outer `.app` directory. This keeps the same installed path and filesystem identity for the Dock. Each package receives a newer numeric build version so macOS refreshes cached metadata and artwork.

The application icon is generated from one SVG source into a reusable 1024px PNG, standard macOS iconset, and ICNS container without relying on `iconutil`. The full-bleed dark-indigo artwork follows the shared Second Brain, FileSorter, and Lopes HQ visual family.

## Persistence

`.openai/hosting.json` declares the logical D1 binding `DB`. `db/state.ts` creates and accesses a single `app_state` table using prepared statements for the web runtime. The Mac app selects an atomic user-local JSON file through a server-only environment path. Both paths persist the same versioned aggregate, preserving a migration path to normalized project, task, document, and handoff tables.

## Second Brain integration

`lib/server/second-brain.ts` is the memory boundary. In the installed app it atomically publishes an index, machine-readable feed, and one structured Markdown note per Orchestrator project beneath `~/Documents/ChatGPT Memory/AI Dev Orchestrator`. The existing Second Brain build already imports that source alongside Claude Memory, so Orchestrator work appears without changing the Claude-owned vault or duplicating its writer.

The same module performs bounded lexical retrieval across both memory roots before a real provider run. It skips private notes, ignores attachments and hidden directories, redacts known credential shapes, returns at most five short excerpts, and labels them as untrusted reference data in the provider prompt. Practice mode does not invoke a model or need memory retrieval.

## Security and reliability boundaries

- No production secrets are included.
- Practice and Subscription modes are explicit in the UI.
- Provider execution remains server-side in the private desktop runtime.
- Handoffs exclude hidden reasoning and credentials.
- Limits are checked in the orchestration domain and reflected in controls.
- Separate planning, review, fix, and reconciliation ceilings stop recursive agent loops.
- Done is computed only from fresh post-change verification, a newer passing independent review, approvals, and disagreement status.
- A production version needs authentication, per-user ownership, idempotent runs, timeouts, retries, observability, and normalized relational tables.
