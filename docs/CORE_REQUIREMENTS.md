# Core product requirements

These requirements define AI Dev Orchestrator v1. They are product constraints, not optional future ideas. A provider adapter, repository integration, or desktop wrapper is incomplete if it bypasses them.

## 1. Mandatory cross-model review

Important changes must be reviewed by a provider independent from the builder:

- Anthropic/Claude builds → OpenAI/GPT reviews.
- OpenAI/GPT or Codex builds → Anthropic/Claude reviews.
- The reviewer assumes the builder may be wrong and verifies claims against evidence.

Standard tasks may use one provider when an independent second model would not add enough value. Task importance must be explicit.

## 2. Agents challenge each other

Review is adversarial but constructive. Reviewers test assumptions, identify missing cases, and may reject another agent's finding. Rejection must include a concrete reason and supporting evidence; blind agreement is not a valid review outcome.

## 3. Disagreement handling

Material disagreements preserve both model positions in the structured handoff. The workflow may run at most one bounded reconciliation round by default. If the conflict remains, the user receives both arguments and makes the decision. The resolution is recorded.

## 4. Permission system

| Action | Default permission |
| --- | --- |
| Read files and search code | Automatic |
| Run tests and inspect git diff | Automatic |
| Edit code | Allowed only in Build or Debug after plan approval |
| Install packages | User approval required |
| Apply database migrations | User approval required |
| Delete files or data | User approval required after exact targets are shown |
| Create branches or commits | User approval required |
| Deploy to production | Always requires user approval |
| Modify secrets | Manual only; an agent never does this automatically |

## 5. Operating modes

Every workflow state resolves to exactly one operating mode:

- **Plan:** explore, plan, challenge, and approve.
- **Build:** implement only the approved scope.
- **Review:** verify evidence and run independent review.
- **Debug:** resolve accepted findings using bounded fix loops.
- **Ship:** confirm the definition of done and request any deployment approval.

## 6. Finite loops

Total agent steps are capped per task. Planning revisions, review revisions, fix rounds, and reconciliation also have separate ceilings. These are safety stops for endless loops, not financial controls. When a ceiling is reached, agents stop and the user decides whether to raise it.

## 7. Repository tool surface

Repository integration is a core product requirement. It must eventually provide permission-wrapped tools to read files, search code, edit code, run commands, run tests, inspect git diff, and create branches or commits. Pull-request support follows in a later phase. The permission policy applies at the tool boundary.

## 8. Purposeful model routing

Do not invoke both providers by default. Route the primary task to the best assigned agent and bring in the other provider when mandatory or when independent review adds material value.

## 9. The project is the shared brain

Project documents, accepted handoffs, and recorded decisions are the source of truth. Important discoveries and architectural decisions must be written to the project; they must not remain trapped in a provider conversation.

## 10. Strict definition of done

A task is done only when all of the following are true:

1. Relevant verification passed and evidence was recorded after the most recent code change.
2. Independent review passed after that verification; important work used the provider opposite the most recent builder.
3. Required human approvals were accepted.
4. No material disagreement remains open.

An agent stating that work is complete is not completion evidence.
Evidence text alone is not a passing result. Verification and review must return an explicit passing outcome with no blocking findings. A fix always returns to verification and independent review before Done.

## 11. Second Brain continuity

AI Dev Orchestrator must not become an isolated memory silo. Desktop saves publish a structured, secret-redacted project and task record to the existing ChatGPT Memory source imported by Second Brain. Real agents retrieve only relevant memory excerpts before work. Claude Memory remains read-only to the Orchestrator; automatic records never bypass its single-writer rule. Retrieved memory is context, not instructions, and never overrides the current approved project plan.
