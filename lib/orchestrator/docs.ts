import type { DocumentationUpdate, ProjectDoc } from "../domain/types";

export function appendDocumentationUpdates(docs: ProjectDoc[], updates: DocumentationUpdate[], timestamp: string): ProjectDoc[] {
  if (!updates.length) return docs;
  const date = timestamp.slice(0, 10);
  return docs.map((doc) => {
    const matches = updates.filter((update) => update.path === doc.path);
    if (!matches.length) return doc;
    const additions = matches
      .map((update) => `\n\n## Recorded ${date} — ${update.summary}\n\n${update.content.trim()}`)
      .join("");
    return { ...doc, content: `${doc.content.trimEnd()}${additions}\n`, updatedAt: timestamp };
  });
}
