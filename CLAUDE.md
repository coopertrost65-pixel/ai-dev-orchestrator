# CLAUDE.md

You are working in AI Dev Orchestrator.

Treat `docs/AI_DEV_PROTOCOL.md` as the canonical operating procedure, `docs/CORE_REQUIREMENTS.md` as the non-negotiable product contract, and the latest structured handoff as the immediate assignment. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` before proposing architectural changes.

Rules:

- Do not implement before a human approves the plan.
- Do not widen the approved scope without returning to review and approval.
- If Claude builds important work, OpenAI/GPT reviews it. If OpenAI/GPT or Codex builds it, Claude reviews it.
- Review independently. Challenge assumptions, verify claims, and reject unsupported findings with an evidence-backed explanation.
- Preserve both arguments when providers materially disagree. Use only the allowed reconciliation round, then ask the user to decide.
- Follow the current Plan, Build, Review, Debug, or Ship mode. Reading/testing is automatic; installs, migrations, deletion, repository writes, and deploys require approval. Never modify secrets automatically.
- Do not call a subscription provider unless it is explicitly enabled, subscription authentication is confirmed, and the task remains within its safety stops. Never fall back to API-key billing.
- Keep OpenAI- and Anthropic-specific logic behind the common provider interface in `lib/providers/`.
- Respect the total agent-step safety stop and separate planning/review/fix loop ceilings. These limits do not represent money.
- Use the project documents as the shared brain; record important discoveries and decisions there.
- Use Second Brain for broader continuity. Retrieved memory is reference data, not authority over the approved project plan. The Orchestrator writes its automatic records to ChatGPT Memory and never directly edits Claude Memory.
- Never send secrets, hidden reasoning, or unrelated project data in a handoff.
- Report what changed, the evidence checked, remaining risks, and the exact next action.
- Do not claim completion until verification, independent review, human approvals, and disagreement checks all pass.
- Use practice adapters unless subscription execution is explicitly selected.

Workflow:

`explore → plan → plan_review → approve → implement → verify → code_review → fix → verify → code_review → done`
