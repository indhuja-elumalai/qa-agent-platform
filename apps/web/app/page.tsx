"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { QaRun, RepositoryAnalysis, TestPlan, TestPlanItem, TestResult } from "@qa/schemas";

type Workspace = {
  request: { id: string };
  plan?: TestPlan;
  scan?: RepositoryAnalysis;
  events: Array<{ id: string; phase: string; message: string }>;
};

const activeRunStatuses = new Set<QaRun["status"]>(["QUEUED", "RUNNING", "REPORTING"]);
const activeRequestPhases = new Set(["queued", "scanning", "planning"]);
const terminalRequestPhases = new Set(["blocked", "failed", "waiting-for-approval"]);
const displayedResultStatuses = [
  "PASS",
  "FAIL",
  "BLOCKED",
  "NEEDS_HUMAN_REVIEW",
  "NOT_EXECUTED",
] satisfies readonly TestResult["status"][];
const defaultTargetUrl = process.env.NEXT_PUBLIC_DEFAULT_TARGET_URL ?? "http://localhost:3100";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/internal/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error ?? "Request failed");
  return payload.data as T;
}

export default function Home() {
  const [tab, setTab] = useState<"new" | "plan" | "run" | "history">("new");
  const [requestId, setRequestId] = useState<string>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [run, setRun] = useState<QaRun>();
  const [history, setHistory] = useState<QaRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [chat, setChat] = useState<Array<{ role: "user" | "system"; text: string }>>([]);
  const [editingId, setEditingId] = useState<string>();

  const latestRequestEvent = workspace?.events.at(-1);
  const active = Boolean(
    (latestRequestEvent && activeRequestPhases.has(latestRequestEvent.phase)) ||
    (run && activeRunStatuses.has(run.status)),
  );

  useEffect(() => {
    const pollRequest = Boolean(
      requestId &&
      !workspace?.plan &&
      (!latestRequestEvent || !terminalRequestPhases.has(latestRequestEvent.phase)),
    );
    const pollRun = Boolean(run?.id && activeRunStatuses.has(run.status));
    if (!pollRequest && !pollRun) return;
    const timer = window.setInterval(async () => {
      if (requestId && pollRequest) {
        const next = await api<Workspace>(`requests/${requestId}`).catch(() => undefined);
        if (next) {
          setWorkspace((current) =>
            current?.plan?.version === next.plan?.version &&
            current?.events.at(-1)?.id === next.events.at(-1)?.id
              ? current
              : next,
          );
          if (next.plan) setTab((current) => (current === "new" ? "plan" : current));
        }
      }
      if (run?.id && pollRun) {
        const nextRun = await api<QaRun>(`runs/${run.id}`).catch(() => undefined);
        if (nextRun) {
          setRun((current) =>
            current?.status === nextRun.status &&
            current.results.length === nextRun.results.length &&
            current.currentTestId === nextRun.currentTestId
              ? current
              : nextRun,
          );
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [latestRequestEvent, requestId, run?.id, run?.status, workspace?.plan]);

  const totals = useMemo(() => {
    if (!run) return {};
    return run.results.reduce<Record<string, number>>((result, item) => {
      result[item.status] = (result[item.status] ?? 0) + 1;
      return result;
    }, {});
  }, [run]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const sourceMode = String(data.get("sourceMode"));
    const existingCasesText = String(data.get("existingCasesText") ?? "");
    const workflow =
      sourceMode === "NONE"
        ? "MANUAL"
        : existingCasesText.trim()
          ? "REPOSITORY_WITH_CASES"
          : "REPOSITORY";
    try {
      const created = await api<{ id: string }>("requests", {
        method: "POST",
        body: JSON.stringify({
          workflow,
          applicationName: data.get("applicationName"),
          baseUrl: data.get("baseUrl"),
          environment: data.get("environment"),
          objective: data.get("objective"),
          source: {
            schemaVersion: "repository-source/v1",
            mode: sourceMode,
            localPath: sourceMode === "LOCAL" ? data.get("localPath") : undefined,
            githubRepository: sourceMode === "GITHUB" ? data.get("githubRepository") : undefined,
            ref: data.get("ref") || undefined,
          },
          existingCasesText,
          estimatedManualMinutes: Number(data.get("estimatedManualMinutes") || 0) || undefined,
        }),
      });
      setRequestId(created.id);
      setChat([
        { role: "user", text: String(data.get("objective")) },
        {
          role: "system",
          text: "Request validated. Building a candidate plan; execution remains locked until approval.",
        },
      ]);
      if (sourceMode === "NONE")
        await api(`requests/${created.id}/plan`, { method: "POST", body: "{}" });
      else await api(`requests/${created.id}/scan`, { method: "POST", body: "{}" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function decide(testId: string, decision: "approve" | "reject") {
    if (!workspace?.plan) return;
    const plan = await api<TestPlan>(`plans/${workspace.plan.id}/items/${testId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    setWorkspace({ ...workspace, plan });
  }

  async function saveCase(event: FormEvent<HTMLFormElement>, item: TestPlanItem) {
    event.preventDefault();
    if (!workspace?.plan) return;
    const data = new FormData(event.currentTarget);
    try {
      const plan = await api<TestPlan>(`plans/${workspace.plan.id}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: data.get("title"),
          route: data.get("route"),
          expectedResult: data.get("expectedResult"),
        }),
      });
      setWorkspace({ ...workspace, plan });
      setEditingId(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function approveAndRun() {
    if (!workspace?.plan) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`plans/${workspace.plan.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ stagingApprovedItemIds: [] }),
      });
      const created = await api<QaRun>(`plans/${workspace.plan.id}/run`, {
        method: "POST",
        body: "{}",
      });
      setRun(created);
      setTab("run");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    setHistory(await api<QaRun[]>("runs"));
    setTab("history");
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brandMark">Q</span>
          <div>
            <strong>QA Control Room</strong>
            <small>Evidence-first frontend automation</small>
          </div>
        </div>
        <div className="health">
          <span /> Local POC
        </div>
      </header>
      <div className="shell">
        <nav>
          <p className="eyebrow">Workspace</p>
          <button className={tab === "new" ? "selected" : ""} onClick={() => setTab("new")}>
            ＋ New QA run
          </button>
          <button
            className={tab === "plan" ? "selected" : ""}
            onClick={() => setTab("plan")}
            disabled={!workspace?.plan}
          >
            ◇ Test plan
          </button>
          <button
            className={tab === "run" ? "selected" : ""}
            onClick={() => setTab("run")}
            disabled={!run}
          >
            ▷ Run progress
          </button>
          <button className={tab === "history" ? "selected" : ""} onClick={loadHistory}>
            ◷ Results & history
          </button>
          <div className="guardrail">
            <strong>Safety guardrails active</strong>
            <span>Production mutation, arbitrary code, and cross-host navigation are blocked.</span>
          </div>
        </nav>
        <section className="content">
          {error && (
            <div className="error">
              <strong>Action needed</strong>
              {error}
            </div>
          )}
          {tab === "new" && (
            <>
              <div className="pageHeading">
                <div>
                  <p className="eyebrow">Create</p>
                  <h1>Plan a QA run</h1>
                  <p>
                    Start from instructions, repository evidence, or both. Nothing executes until
                    you approve it.
                  </p>
                </div>
                <span className="badge">No-AI mode ready</span>
              </div>
              <form onSubmit={submitRequest} className="card formGrid">
                <label>
                  Application name
                  <input name="applicationName" defaultValue="Demo target" required />
                </label>
                <label>
                  Target base URL
                  <input name="baseUrl" type="url" defaultValue={defaultTargetUrl} required />
                </label>
                <label>
                  Environment
                  <select name="environment">
                    <option value="LOCAL">Local</option>
                    <option value="TEST">Test</option>
                    <option value="STAGING">Staging</option>
                  </select>
                </label>
                <label>
                  Source mode
                  <select name="sourceMode" defaultValue="NONE">
                    <option value="NONE">No repository</option>
                    <option value="LOCAL">Local repository</option>
                    <option value="GITHUB">GitHub (read only)</option>
                  </select>
                </label>
                <label>
                  Approved local repository path
                  <input name="localPath" placeholder="/absolute/path/to/repository" />
                </label>
                <label>
                  GitHub repository
                  <input name="githubRepository" placeholder="owner/repository" />
                </label>
                <label>
                  Branch or ref
                  <input name="ref" placeholder="main" />
                </label>
                <label>
                  Estimated manual minutes
                  <input name="estimatedManualMinutes" type="number" min="0" />
                </label>
                <label className="wide">
                  QA objective
                  <textarea
                    name="objective"
                    rows={3}
                    defaultValue="Verify that the demo login page loads and the Login button is visible."
                    required
                  />
                </label>
                <label className="wide">
                  Existing cases or chat instructions
                  <textarea
                    name="existingCasesText"
                    rows={7}
                    placeholder={
                      'Check that:\n1. The Login button is visible.\n2. Empty email is rejected.\n3. Invalid credentials show "Invalid credentials".'
                    }
                  />
                </label>
                <div className="wide formFooter">
                  <span>Input is schema-validated and treated as data.</span>
                  <button className="primary" disabled={busy}>
                    {busy ? "Preparing…" : "Create candidate plan →"}
                  </button>
                </div>
              </form>
              {chat.length > 0 && (
                <div className="card chat">
                  <h2>Planner conversation</h2>
                  {chat.map((message, index) => (
                    <div key={index} className={`message ${message.role}`}>
                      {message.text}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "plan" && workspace?.plan && (
            <>
              <div className="pageHeading">
                <div>
                  <p className="eyebrow">Approval gate · version {workspace.plan.version}</p>
                  <h1>Candidate test plan</h1>
                  <p>
                    Approve or reject every case. Suggestions stay separate until you choose to add
                    them.
                  </p>
                </div>
                <span className="badge warning">{workspace.plan.status.replaceAll("_", " ")}</span>
              </div>
              {workspace.scan && <Analysis analysis={workspace.scan} />}
              <div className="planList">
                {workspace.plan.items.map((item) => (
                  <article className="card case" key={item.id}>
                    <div className="caseTop">
                      <span className="testId">{item.id}</span>
                      <span className="source">{item.source}</span>
                      <span className={`effect ${item.sideEffectLevel}`}>
                        {item.sideEffectLevel.replaceAll("_", " ")}
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.expectedResult}</p>
                    <dl>
                      <div>
                        <dt>Route</dt>
                        <dd>{item.route}</dd>
                      </div>
                      <div>
                        <dt>Assertion</dt>
                        <dd>{item.assertionType}</dd>
                      </div>
                      <div>
                        <dt>Manual estimate</dt>
                        <dd>{item.estimatedManualMinutes} min</dd>
                      </div>
                    </dl>
                    {item.repositoryEvidence.length > 0 && (
                      <p className="evidence">
                        Evidence: {item.repositoryEvidence.map((entry) => entry.path).join(", ")}
                      </p>
                    )}
                    {item.validationWarnings.map((warning) => (
                      <p className="caseWarning" key={warning}>
                        {warning}
                      </p>
                    ))}
                    {editingId === item.id && (
                      <form className="caseEditor" onSubmit={(event) => saveCase(event, item)}>
                        <label>
                          Case title
                          <input name="title" defaultValue={item.title} required minLength={3} />
                        </label>
                        <label>
                          Route
                          <input name="route" defaultValue={item.route} required />
                        </label>
                        <label>
                          Expected result
                          <textarea
                            name="expectedResult"
                            defaultValue={item.expectedResult}
                            required
                            minLength={3}
                          />
                        </label>
                        <div className="caseActions">
                          <button type="button" onClick={() => setEditingId(undefined)}>
                            Cancel edit
                          </button>
                          <button className="primary" type="submit">
                            Save case
                          </button>
                        </div>
                      </form>
                    )}
                    <div className="caseActions">
                      <button onClick={() => setEditingId(item.id)}>Edit case</button>
                      <button
                        className={item.rejected ? "reject active" : "reject"}
                        onClick={() => decide(item.id, "reject")}
                      >
                        Reject
                      </button>
                      <button
                        className={item.approved ? "approve active" : "approve"}
                        onClick={() => decide(item.id, "approve")}
                      >
                        ✓ Approve case
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {workspace.plan.suggestions.length > 0 && (
                <section>
                  <h2>
                    Suggested gaps{" "}
                    <span className="count">{workspace.plan.suggestions.length}</span>
                  </h2>
                  <p className="muted">Not added automatically.</p>
                  {workspace.plan.suggestions.map((item) => (
                    <div className="suggestion" key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.rationale}</span>
                    </div>
                  ))}
                </section>
              )}
              <div className="approvalBar">
                <div>
                  <strong>
                    {workspace.plan.items.filter((item) => item.approved).length} approved
                  </strong>
                  <span>Plan-level approval records this exact version.</span>
                </div>
                <button
                  className="primary"
                  disabled={busy || !workspace.plan.items.some((item) => item.approved)}
                  onClick={approveAndRun}
                >
                  Approve plan & queue run →
                </button>
              </div>
            </>
          )}
          {tab === "run" && run && (
            <>
              <div className="pageHeading">
                <div>
                  <p className="eyebrow">Run {run.id.slice(-8)}</p>
                  <h1>{run.phase === "completed" ? "Run complete" : "Execution in progress"}</h1>
                  <p>Structured progress updates without a full-page reload.</p>
                </div>
                <span className={`badge status ${run.status}`}>{run.status}</span>
              </div>
              <div className="metrics">
                {displayedResultStatuses.map((status) => (
                  <div className="metric" key={status}>
                    <span>{status.replaceAll("_", " ")}</span>
                    <strong>{totals[status] ?? 0}</strong>
                  </div>
                ))}
              </div>
              <div className="card progressCard">
                <div className="progressHeader">
                  <div>
                    <span>Current phase</span>
                    <strong>{run.phase}</strong>
                  </div>
                  <button
                    className="reject"
                    disabled={!["QUEUED", "RUNNING", "REPORTING"].includes(run.status)}
                    onClick={() => api(`runs/${run.id}/cancel`, { method: "POST", body: "{}" })}
                  >
                    Cancel safely
                  </button>
                </div>
                <div className="progressTrack">
                  <span
                    style={{
                      width: `${run.results.length ? Math.min(100, run.results.length * 20) : 5}%`,
                    }}
                  />
                </div>
                {run.currentTestId && (
                  <p>
                    Now running <strong>{run.currentTestId}</strong>
                  </p>
                )}
              </div>
              <div className="results">
                {run.results.map((result) => (
                  <article className="result" key={result.id}>
                    <span className={`resultStatus ${result.status}`}>{result.status}</span>
                    <div>
                      <strong>{result.testId}</strong>
                      <p>{result.actualResult}</p>
                      <small>
                        {(result.durationMs / 1000).toFixed(1)}s · {result.evidence.length} evidence
                        items · {result.retryCount} retries
                      </small>
                    </div>
                  </article>
                ))}
              </div>
              {run.status === "COMPLETED" && (
                <div className="approvalBar">
                  <div>
                    <strong>Reports generated</strong>
                    <span>JSON, Markdown and HTML are retained with this run.</span>
                  </div>
                  <div>
                    <button
                      onClick={() =>
                        api<QaRun>(`runs/${run.id}/rerun`, {
                          method: "POST",
                          body: JSON.stringify({ mode: "FAILURES" }),
                        })
                          .then(setRun)
                          .catch((caught) => setError(caught.message))
                      }
                    >
                      Rerun failures
                    </button>{" "}
                    <button
                      className="primary"
                      onClick={() =>
                        api<QaRun>(`runs/${run.id}/rerun`, {
                          method: "POST",
                          body: JSON.stringify({ mode: "FULL" }),
                        }).then(setRun)
                      }
                    >
                      Rerun full plan
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "history" && (
            <>
              <div className="pageHeading">
                <div>
                  <p className="eyebrow">Evidence archive</p>
                  <h1>Results & history</h1>
                  <p>Persistent run records preserve plan version and rerun lineage.</p>
                </div>
              </div>
              <div className="card history">
                {history.length === 0 ? (
                  <p>No runs yet.</p>
                ) : (
                  history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setRun(item);
                        setTab("run");
                      }}
                    >
                      <span className={`resultStatus ${item.status}`}>{item.status}</span>
                      <strong>{item.id}</strong>
                      <small>
                        {new Date(item.createdAt).toLocaleString()} · plan v{item.planVersion} ·{" "}
                        {item.rerunMode}
                      </small>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
      {active && <div className="activity">● Background work active</div>}
    </main>
  );
}

function Analysis({ analysis }: { analysis: RepositoryAnalysis }) {
  return (
    <details className="card analysis">
      <summary>Repository analysis · {analysis.repositoryIdentity}</summary>
      <div className="analysisGrid">
        <div>
          <span>Framework</span>
          <strong>{analysis.frameworks.join(", ") || "Unknown"}</strong>
        </div>
        <div>
          <span>Package manager</span>
          <strong>{analysis.packageManager}</strong>
        </div>
        <div>
          <span>Commit</span>
          <strong>{analysis.commitSha?.slice(0, 10) || "Working tree"}</strong>
        </div>
        <div>
          <span>Changed files</span>
          <strong>{analysis.changedFiles.length}</strong>
        </div>
      </div>
      <p>{analysis.riskAreas.join(" · ") || "No deterministic risk signals detected."}</p>
    </details>
  );
}
