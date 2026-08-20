# AI Dev Orchestrator

A local-first TypeScript web app for coordinating OpenAI/Codex-style and Anthropic/Claude-style agents through a controlled software-development workflow.

The v1 includes a paste-first request composer, projects and tasks, four agent roles, a nine-state workflow, mandatory cross-model review for important work, adversarial disagreements and bounded reconciliation, five operating modes, a permission policy, shared project docs, two human approval gates, structured handoffs, finite safety stops, a strict definition of done, durable state, subscription usage visibility, deterministic Practice mode, and subscription-authenticated local coding adapters.

## Quick start

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. No API keys are needed. The browser version starts in Practice mode and cannot change an external project.

## Mac app

The packaged Mac version starts its private local server automatically, opens in its own window, and stores app data under the signed-in macOS user's Application Support folder. It does not deploy anything or require a localhost tab.

Practice mode runs the workflow with deterministic responses, calls no model, and changes no code. In the installed Mac app, Subscription mode can work on a user-chosen local Git project by calling Codex or Claude Code already signed in through a subscription. The server strips API-key variables, verifies subscription sign-in, and rejects the run instead of falling back to usage-based API authentication.

The app does not buy credits, enable extra usage, or fall back to an API key. Subscription runs consume the plan allowance of the account already signed in on the Mac. A provider account's previously enabled extra-usage setting remains controlled by that provider account.

The Usage screen reads Codex's live included-usage windows and shows optional paid credits separately. Claude usage is shown only when Claude supplies a real usage event during an app run; otherwise the app says that the exact percentage is unavailable and links to Claude's official usage page. If a provider reports that its limit is reached, ordinary work can route to the other connected provider. Mandatory independent review pauses instead of allowing the builder to review itself.

```bash
npm run desktop:package
```

The signed `.app` bundle is delivered as a ZIP in `outputs/`. Open the ZIP, then drag **AI Dev Orchestrator** to Applications. The source remains a normal TypeScript project, so either Claude Code or Codex can edit it regardless of which subscription is active.

For later builds, use `npm run desktop:update`. It packages the app and synchronizes the signed contents into the existing `/Applications/AI Dev Orchestrator.app` directory instead of deleting that directory. The stable bundle identifier, path, outer-directory identity, and incremented build number keep an existing Dock item attached to the updated app.

`npm run assets:icon` regenerates the complete brand asset set from `desktop/icon.svg`: a 1024px PNG, every standard macOS iconset size, and a modern ICNS container. Packaging also writes `outputs/AI-Dev-Orchestrator-Icon-Assets.zip`.

## Validation

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

`npm test` runs the complete validation sequence.

## How the workflow works

Every task follows:

```text
Understand → Plan → Second opinion → Your approval → Build → Test → Second opinion → Improve → Finished
```

The user must approve the reviewed plan before implementation and accept final review findings before the improvement phase. For important work, the reviewer always uses the provider opposite the builder and takes an explicit challenge stance. Every model response is normalized into a structured handoff with a summary, concrete output, evidence, risks, challenges, disagreement positions, next action, and decision status.

The canonical procedure lives in [docs/AI_DEV_PROTOCOL.md](docs/AI_DEV_PROTOCOL.md), and the ten non-negotiable product rules live in [docs/CORE_REQUIREMENTS.md](docs/CORE_REQUIREMENTS.md).

## Persistence

The local runtime provides the logical D1 binding declared in `.openai/hosting.json`. `/api/state` persists the versioned application state in the `app_state` table. If storage is temporarily unavailable, the UI stays usable in clearly labeled session mode.

## Subscription connections

The installed Mac app detects local subscription-authenticated coding tools. The integration points are:

- `lib/providers/types.ts` — shared adapter contract.
- `lib/providers/openai.ts` — Codex subscription adapter for `/api/providers/openai`.
- `lib/providers/anthropic.ts` — Claude subscription adapter for `/api/providers/anthropic`.
- `lib/providers/mock.ts` — deterministic Practice mode adapters.
- `lib/providers/usage.ts` — provider-neutral usage and limit normalization.
- `lib/server/subscription-providers.ts` — authentication checks, folder authorization, permission mode, structured output, and timeouts.

Codex requires the CLI from the ChatGPT Mac app or system path, and `codex login status` must report ChatGPT authentication. Claude requires Claude Code installed separately, and `claude auth status` must confirm a Claude subscription rather than Console/API authentication.

The user grants access to one exact folder through the Mac folder picker. Subscription runs require a Git repository. Planning and review run read-only; Build and Improve use workspace-limited editing after plan approval. Installs, migrations, deletion, commits, deploys, and secret changes remain prohibited by the execution boundary.

## Provider-neutral ownership

The source is a normal local TypeScript repository, not a ChatGPT-owned or Claude-owned project. Claude Code, Codex, or another capable coding tool can edit the same files. Cancelling access to one assistant does not lock the source; it only removes that provider or editing service until you configure access again. Practice mode requires no provider connection.

The macOS desktop wrapper does not change this ownership model. Electron packaging dependencies were installed only after explicit approval under the project's permission policy.

The product intentionally shows no dollar estimates. Safety stops count agent steps and revision loops only; they do not represent money.

## Project map

```text
app/                       App Router pages and state API
components/                Interactive orchestration workspace
db/                        D1 schema and prepared state access
lib/domain/                Durable project, task, agent, and handoff types
lib/orchestrator/          State machine and gate rules
lib/providers/             Practice and subscription provider adapters
lib/server/                Desktop-only subscription execution boundary
docs/                      Protocol, product, architecture, and decisions
AGENTS.md                  Codex-style persistent instructions
CLAUDE.md                  Claude-style persistent instructions
```

## Safety defaults

- Practice mode is active by default.
- No production secrets are included.
- No deployment is configured or performed by these setup steps.
- Agent-step and revision safety stops prevent endless loops.
- Separate planning, review, fix, and reconciliation ceilings prevent infinite loops.
- Important changes must cross provider families for review.
- Package installs, migrations, deletion, repository writes, and deploys require approval; secrets are manual-only.
- Done requires verification, independent review, accepted approvals, and no open disagreement.
- Provider errors do not advance workflow state.
- Human gates cannot be skipped by a model response.
