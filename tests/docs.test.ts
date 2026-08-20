import assert from "node:assert/strict";
import test from "node:test";
import { appendDocumentationUpdates } from "../lib/orchestrator/docs.ts";
import type { ProjectDoc } from "../lib/domain/types.ts";

const docs: ProjectDoc[] = [{
  id: "decisions",
  path: "docs/DECISIONS.md",
  title: "Decisions",
  description: "Accepted project decisions",
  content: "# Decisions\n",
  updatedAt: "2026-08-19T00:00:00.000Z",
}];

test("accepted discoveries append to durable project docs", () => {
  const updated = appendDocumentationUpdates(docs, [{
    path: "docs/DECISIONS.md",
    summary: "Keep verification fresh",
    content: "Every fix returns to verification and independent review.",
  }], "2026-08-20T00:00:00.000Z");
  assert.match(updated[0].content, /Recorded 2026-08-20/);
  assert.match(updated[0].content, /Every fix returns to verification/);
  assert.equal(updated[0].updatedAt, "2026-08-20T00:00:00.000Z");
});
