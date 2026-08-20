import {
  CORE_REQUIREMENTS,
  OPERATING_MODES,
  PERMISSION_RULES,
  REPOSITORY_TOOL_ROADMAP,
} from "@/lib/orchestrator/policy";

const statusLabels: Record<string, string> = {
  enforced: "Enforced now",
  modeled: "Approval gate active",
  "core-roadmap": "Boundary in progress",
};

export function PolicyView() {
  return (
    <div className="collection-view policy-view">
      <div className="collection-header policy-header">
        <div>
          <p className="eyebrow">Control plane</p>
          <h2>Agents collaborate under rules, not vibes.</h2>
          <p>These are product requirements. Provider prompts and future repository tools must implement the same policy.</p>
        </div>
        <span className="policy-lock"><i aria-hidden="true" /> Protocol locked</span>
      </div>

      <section className="policy-section" aria-labelledby="requirements-heading">
        <div className="policy-section-heading">
          <div><p className="section-label">{CORE_REQUIREMENTS.length} core requirements</p><h3 id="requirements-heading">What must remain true</h3></div>
          <p>The app distinguishes enforced workflow rules from repository boundaries that still depend on provider tooling.</p>
        </div>
        <div className="requirement-list">
          {CORE_REQUIREMENTS.map((requirement, index) => (
            <article key={requirement.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h4>{requirement.label}</h4><p>{requirement.detail}</p></div>
              <i className={`policy-status policy-status-${requirement.status}`}>{statusLabels[requirement.status]}</i>
            </article>
          ))}
        </div>
      </section>

      <section className="policy-section modes-section" aria-labelledby="modes-heading">
        <div className="policy-section-heading">
          <div><p className="section-label">Operating modes</p><h3 id="modes-heading">One mode controls what agents may do</h3></div>
        </div>
        <ol className="mode-sequence">
          {OPERATING_MODES.map((mode, index) => (
            <li key={mode.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{mode.label}</strong><p>{mode.purpose}</p></li>
          ))}
        </ol>
      </section>

      <div className="policy-two-column">
        <section className="policy-section" aria-labelledby="permissions-heading">
          <div className="policy-section-heading"><div><p className="section-label">Permission system</p><h3 id="permissions-heading">Risk decides the gate</h3></div></div>
          <div className="permission-list">
            {PERMISSION_RULES.map((rule) => (
              <div key={rule.action}><p><strong>{rule.action}</strong><small>{rule.detail}</small></p><span className={`permission-${rule.level}`}>{rule.level.replaceAll("_", " ")}</span></div>
            ))}
          </div>
        </section>

        <section className="policy-section" aria-labelledby="tools-heading">
          <div className="policy-section-heading"><div><p className="section-label">Repository tools</p><h3 id="tools-heading">The required tool surface</h3></div></div>
          <div className="tool-list">
            {REPOSITORY_TOOL_ROADMAP.map((item) => (
              <div key={item.tool}><span className={`tool-status tool-status-${item.status}`} aria-hidden="true" /><p><strong>{item.tool}</strong><small>{item.permission}</small></p><i>{item.status === "later" ? "Later phase" : "Core"}</i></div>
            ))}
          </div>
        </section>
      </div>

      <section className="done-contract" aria-labelledby="done-contract-heading">
        <p className="section-label">Definition of done</p>
        <h3 id="done-contract-heading">An agent’s confidence is not completion evidence.</h3>
        <div><span>01</span><p><strong>Verification passed</strong><small>Relevant checks ran and produced recorded evidence.</small></p></div>
        <div><span>02</span><p><strong>Independent review passed</strong><small>For important work, the reviewer used the provider opposite the builder.</small></p></div>
        <div><span>03</span><p><strong>Approvals cleared</strong><small>The plan and final findings were explicitly accepted.</small></p></div>
        <div><span>04</span><p><strong>No open disagreement</strong><small>Both arguments were presented and the decision was recorded.</small></p></div>
      </section>
    </div>
  );
}
