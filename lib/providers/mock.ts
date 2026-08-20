import type { ProviderId, WorkflowPhase } from "../domain/types";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "./types";

type MockCopy = Omit<ProviderResponse, "usage" | "outcome" | "blockingFindings" | "documentationUpdates" | "permissionRequests"> & Partial<Pick<ProviderResponse, "outcome" | "blockingFindings" | "documentationUpdates" | "permissionRequests">>;

const copy: Record<WorkflowPhase, MockCopy> = {
  explore: {
    summary: "Project context explored and constraints captured.",
    details: ["Mapped the relevant project surfaces", "Identified the persistent instructions", "Bounded the requested outcome"],
    evidence: ["Project docs attached to the run", "Existing task history checked"],
    risks: ["Live provider behavior is intentionally excluded from this mock run"],
    nextAction: "Turn the explored constraints into a concrete implementation plan.",
  },
  plan: {
    summary: "A bounded implementation plan is ready for independent review.",
    details: ["Define the smallest useful product slice", "Preserve provider-neutral boundaries", "Verify each workflow transition"],
    evidence: ["Plan references the task brief and shared project docs"],
    risks: ["Scope can expand if approval feedback is not specific"],
    documentationUpdates: [{ path: "docs/DECISIONS.md", summary: "Record the approved implementation boundary", content: "Use the smallest safe implementation boundary and verify it before completion." }],
    nextAction: "Review assumptions, ordering, and failure modes.",
  },
  plan_review: {
    summary: "Plan reviewed; the remaining tradeoffs are ready for human approval.",
    details: ["Confirmed each requested capability has an owner", "Checked provider boundaries", "Verified the test path"],
    evidence: ["No implementation step precedes the approval gate", "Limits remain enforceable"],
    risks: ["Retries will require idempotency when live providers are connected"],
    stance: "challenge",
    challenges: [
      "The architect assumed a shared schema alone would prevent context loss.",
      "The plan did not yet prove how conflicting provider recommendations stay visible.",
    ],
    disagreement: {
      status: "open",
      summary: "The models disagree on how much structure belongs in the first implementation.",
      arguments: [
        { provider: "openai", position: "Keep the first contract minimal and provider-neutral." },
        { provider: "anthropic", position: "Add explicit challenge and disagreement records before agents exchange work." },
      ],
    },
    nextAction: "Approve the plan or return it with a concrete change request.",
  },
  approve: {
    summary: "Human approval is required.",
    details: [],
    evidence: [],
    risks: [],
    nextAction: "Approve or request changes.",
  },
  implement: {
    summary: "Approved changes implemented within the agreed scope.",
    details: ["Applied the planned product changes", "Preserved provider-neutral contracts", "Recorded implementation notes"],
    evidence: ["Changed surfaces match the approved plan"],
    risks: ["Mock execution does not modify an external repository"],
    nextAction: "Verify the implementation with proportionate checks.",
  },
  verify: {
    summary: "Verification completed and evidence packaged for review.",
    details: ["Checked workflow transitions", "Checked limit enforcement", "Checked persistent state shape"],
    evidence: ["All mock checks passed", "No approval gate was bypassed"],
    risks: ["Live API latency and provider errors remain untested"],
    outcome: "passed",
    nextAction: "Review the implementation and verification evidence independently.",
  },
  code_review: {
    summary: "Implementation review produced a bounded set of findings.",
    details: ["Reviewed scope against the approved plan", "Inspected verification evidence", "Separated blockers from polish"],
    evidence: ["One minor hardening change recommended", "No gate or limit bypass found"],
    risks: ["Provider-specific error payloads need normalization before live use"],
    outcome: "changes_required",
    blockingFindings: ["Normalize the remaining provider-specific error boundary."],
    stance: "challenge",
    challenges: [
      "Passing tests do not prove that the builder respected every permission boundary.",
      "The builder's completion claim must be checked against the explicit definition of done.",
    ],
    disagreement: {
      status: "open",
      summary: "The builder and reviewer differ on whether the remaining provider-normalization risk blocks completion.",
      arguments: [
        { provider: "anthropic", position: "The bounded mock workflow is complete for this local version." },
        { provider: "openai", position: "The live-provider error boundary must remain an explicit open risk." },
      ],
    },
    nextAction: "Accept the findings, then run the fix phase.",
  },
  fix: {
    summary: "Accepted findings resolved; the task is ready to close.",
    details: ["Applied the bounded hardening change", "Rechecked affected behavior", "Updated the handoff timeline"],
    evidence: ["Review finding marked resolved"],
    risks: [],
    nextAction: "Re-run verification, then obtain a fresh independent review.",
  },
  done: {
    summary: "Task complete.",
    details: [],
    evidence: [],
    risks: [],
    nextAction: "Start another task when ready.",
  },
};

export const mockUsageByProvider: Record<ProviderId, ProviderResponse["usage"]> = {
  openai: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
  anthropic: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
};

export class MockProviderAdapter implements ProviderAdapter {
  readonly mode = "mock" as const;
  readonly label: string;
  readonly id: ProviderId;
  private readonly delayMs: number;

  constructor(id: ProviderId, delayMs = 520) {
    this.id = id;
    this.delayMs = delayMs;
    this.label = id === "openai" ? "OpenAI · Mock" : "Anthropic · Mock";
  }

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const response = copy[request.phase];
    if (request.reconciliation) {
      return {
        ...response,
        outcome: "passed",
        blockingFindings: [],
        documentationUpdates: [],
        permissionRequests: [],
        disagreement: {
          ...request.reconciliation,
          status: "reconciled",
          resolution: "The bounded reconciliation kept the stricter evidence requirement and the smallest safe implementation boundary.",
        },
        summary: "The disagreement was reconsidered and a bounded resolution was recorded.",
        nextAction: "Review the preserved positions and recorded resolution.",
        usage: mockUsageByProvider[this.id],
      };
    }
    const isReview = request.phase === "plan_review" || request.phase === "code_review";
    const disagreement = isReview && request.crossModelReview && request.builderProvider
      ? {
          ...response.disagreement,
          status: "open" as const,
          summary: response.disagreement?.summary ?? "The builder and reviewer recommend different boundaries.",
          arguments: [
            { provider: request.builderProvider, position: "The builder favors the smallest boundary supported by its current evidence." },
            { provider: this.id, position: "The independent reviewer favors explicit safeguards where the builder's evidence leaves ambiguity." },
          ],
        }
      : undefined;
    const hasFix = request.task.handoffs.some((handoff) => handoff.phase === "fix");
    const postFixReview = request.phase === "code_review" && hasFix;
    return {
      ...response,
      outcome: postFixReview ? "passed" : response.outcome ?? "informational",
      blockingFindings: postFixReview ? [] : response.blockingFindings ?? [],
      documentationUpdates: response.documentationUpdates ?? [],
      permissionRequests: response.permissionRequests ?? [],
      disagreement: postFixReview ? undefined : disagreement,
      summary: postFixReview ? "The corrected implementation passed fresh independent review." : response.summary,
      risks: postFixReview ? [] : response.risks,
      nextAction: postFixReview ? "Accept the clean review to finish the task." : response.nextAction,
      usage: mockUsageByProvider[this.id],
    };
  }
}

export const mockProviders: Record<ProviderId, ProviderAdapter> = {
  openai: new MockProviderAdapter("openai"),
  anthropic: new MockProviderAdapter("anthropic"),
};
