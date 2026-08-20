# Product

## Summary

AI Dev Orchestrator is a web-based command center for coordinating complementary AI software-development agents. It gives one user a controlled workflow, shared context, explicit approvals, and an auditable record of what each model proposed or verified.

## User

The v1 user is a builder who wants AI assistance but does not want to manually copy context between tools or allow autonomous agents to change code without review.

## Problem

Unstructured multi-model collaboration loses context, duplicates work, and blurs responsibility. A long chat transcript does not define who may act, when work is approved, what was verified, or when agents must stop revising.

## V1 outcome

The user can:

- paste an unstructured conversation, rough idea, bug, or feature request into one large composer;
- create projects and scoped development tasks without filling a technical intake form;
- assign architect, implementer, reviewer, and tester roles across OpenAI/Codex-style and Anthropic/Claude-style providers;
- move a task through the canonical nine-stage protocol, including fresh verification and review after a fix;
- review structured handoffs between roles;
- approve plans and review findings explicitly;
- edit the shared project documents used as agent context;
- set optional agent-step and revision safety stops;
- mark work important so reviews automatically use the provider opposite the builder;
- inspect adversarial review challenges, both sides of a disagreement, and its recorded resolution;
- work in explicit Plan, Build, Review, Debug, and Ship modes;
- set separate finite ceilings for planning, review, fix, and reconciliation loops;
- see the permission policy and required repository-tool surface inside the product;
- prevent Done until fresh post-change verification, independent review, approvals, and disagreement checks pass;
- exercise the complete product using deterministic practice providers;
- choose a local Git project folder and run connected Codex or Claude Code tools through subscription authentication;
- see each provider's confirmed usage status, remaining allowance when available, and reset guidance;
- receive a clear warning and safe routing behavior when one provider reaches its limit;
- preserve application state across local sessions through D1.
- automatically sync structured project activity into the existing Obsidian/Second Brain system without writing directly to Claude Memory;
- retrieve relevant Second Brain context before real Codex or Claude work instead of loading the entire vault.

## Non-goals for v1

- Pull requests and hosted repository connections. V1 works with a local Git project folder.
- Authentication, teams, or fine-grained permissions.
- Buying credits, changing extra-usage settings, or managing provider billing.
- Production retry queues, distributed locks, or background workers.
- API-key authentication or automatic fallback to usage-based API billing.
- Deployment from this repository.

## Success criteria

V1 is successful when a user can paste a request without translating it into technical fields, understand every stage, practice locally without calling a model, optionally work on a chosen Git project through confirmed subscription authentication, and never encounter a dollar estimate or API-key fallback. Provider usage must be truthful about what is live, last confirmed, or unavailable, and limit exhaustion must never weaken independent review. Approval gates, cross-model review, disagreements, safety stops, persistent projects, Second Brain continuity, and the definition of done remain enforced.

The eleven non-negotiable completion criteria are recorded in `docs/CORE_REQUIREMENTS.md` and surfaced in the in-app Policy view.
