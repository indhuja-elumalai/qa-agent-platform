# QA Agent Platform — Manual User & Testing Guide

This guide is for a new team member who needs to install, start, use, and inspect the QA Agent Platform without reading its source code. It describes the current local, single-user proof of concept exactly as implemented.

The platform turns plain-language test instructions and optional read-only repository facts into a candidate test plan. A person reviews every case and approves an exact plan version. Only then does Playwright run the approved browser actions and assign deterministic results.

> **Safety boundary:** use only local, test, or approved staging targets. Production-like hosts, cross-origin navigation, arbitrary scripts, prohibited side effects, and repositories outside configured roots are blocked.

## Quick reference

| Item                  | Default                                               |
| --------------------- | ----------------------------------------------------- |
| Control-room UI       | `http://localhost:3000`                               |
| Demo target           | `http://localhost:3100` (redirects to `/login`)       |
| Liveness              | `http://localhost:3000/api/health`                    |
| Readiness             | `http://localhost:3000/api/readiness`                 |
| Database              | `$QA_DATABASE_PATH`                                   |
| Evidence              | `$QA_DATA_DIR/evidence/<run-id>/<test-id>/`           |
| Reports               | `$QA_DATA_DIR/reports/<run-id>/report.{json,md,html}` |
| Runtime configuration | ignored `.env.local`                                  |

Use absolute values for `QA_DATA_DIR`, `QA_DATABASE_PATH`, repository roots, configuration roots, and authentication-state paths. Absolute paths make the CLI initializer and the Next.js server use the same files regardless of their working directory.

Shell examples that use `$QA_DATA_DIR` assume that you either substitute its configured absolute value or load `.env.local` without tracing:

```bash
set +x
set -a
source .env.local
set +a
```

---

# Part 1 — Environment setup

## 1.1 Required software

- Git.
- Node.js **22.5 or newer**. An active Node 22 LTS release is recommended.
- Corepack, supplied with supported Node distributions.
- pnpm **10.14.0**, selected by the repository through Corepack.
- A Playwright-compatible Chromium browser.
- Docker Engine and Docker Compose only if you want the optional container workflow.
- `curl` for health checks and API examples.
- `jq` for the optional API-driven KOG procedure.

Check the tools:

```bash
git --version
node --version
corepack --version
docker --version       # optional
docker compose version # optional
jq --version           # needed only for the KOG API examples
```

`node --version` must be `v22.5.0` or newer.

## 1.2 Clone and install

```bash
git clone <approved-private-repository-url> qa-agent-platform
cd qa-agent-platform
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
```

Expected installation signals:

- pnpm reports that dependencies were installed or that the lockfile was already up to date.
- Playwright reports Chromium installed, or completes without an error when the matching browser is already cached.

Do not run `npm install`, and do not edit the lockfile merely to start the platform.

## 1.3 Create local runtime configuration

Create the ignored runtime file:

```bash
cp .env.example .env.local
pwd
```

Open `.env.local` in a local editor. Replace `/absolute/path/to/qa-agent-platform` below with the path printed by `pwd`:

```env
PORT=3000
DEMO_TARGET_PORT=3100

QA_DATA_DIR=/absolute/path/to/qa-agent-platform/var
QA_DATABASE_PATH=/absolute/path/to/qa-agent-platform/var/qa-platform.db

QA_ALLOWED_REPOSITORY_ROOTS=/absolute/path/to/qa-agent-platform
QA_ALLOWED_CONFIGURATION_ROOTS=/absolute/path/to/qa-agent-platform/config/pilots
QA_ALLOWED_TARGET_HOSTS=localhost,127.0.0.1
NEXT_PUBLIC_DEFAULT_TARGET_URL=http://localhost:3100

QA_MAX_SCAN_FILES=5000
QA_MAX_SCAN_FILE_BYTES=524288
QA_MAX_CASES=100
QA_BROWSER_TIMEOUT_MS=30000
QA_RUN_TIMEOUT_MS=600000
QA_ACTION_RETRIES=1

GITHUB_CONNECTOR_ENABLED=false
GITHUB_TOKEN=

AI_TEST_PLANNING_ENABLED=false
AI_PROVIDER=
AI_MODEL=
OPENAI_API_KEY=
AI_REQUEST_TIMEOUT_MS=30000
AI_MAX_INPUT_FILES=20
AI_MAX_INPUT_BYTES=200000

LOG_LEVEL=info
```

`.env.local` is ignored by Git. Confirm before entering any secret:

```bash
git check-ignore -v .env.local
```

The output should identify a `.gitignore` rule for `.env.local`.

Never paste an API key, GitHub token, password, cookie, or Playwright storage state into a plan, report, issue, chat, commit, or command that prints its value. If a key is ever pasted into chat or terminal history, revoke and rotate it.

## 1.4 Environment-variable reference

| Variable                         | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `PORT`                           | Control-room web port; default `3000`.                                       |
| `DEMO_TARGET_PORT`               | Isolated demo port; default `3100`.                                          |
| `QA_DATA_DIR`                    | Parent directory for evidence and reports. Prefer an absolute path.          |
| `QA_DATABASE_PATH`               | SQLite database path. Prefer an absolute path under `QA_DATA_DIR`.           |
| `QA_ALLOWED_REPOSITORY_ROOTS`    | Comma-separated directories beneath which local repositories may be scanned. |
| `QA_ALLOWED_CONFIGURATION_ROOTS` | Comma-separated directories from which pilot JSON profiles may be loaded.    |
| `QA_ALLOWED_TARGET_HOSTS`        | Comma-separated target hostnames. Ports are not included.                    |
| `NEXT_PUBLIC_DEFAULT_TARGET_URL` | URL prefilled in **Target base URL** at build/dev start.                     |
| `QA_MAX_SCAN_FILES`              | Maximum visited files during a local scan.                                   |
| `QA_MAX_SCAN_FILE_BYTES`         | Maximum bytes read from one text file.                                       |
| `QA_MAX_CASES`                   | Maximum combined plan items and suggestions.                                 |
| `QA_BROWSER_TIMEOUT_MS`          | Browser/action timeout used by the runner.                                   |
| `QA_RUN_TIMEOUT_MS`              | Whole-run timeout.                                                           |
| `QA_ACTION_RETRIES`              | Retries after a failed attempt; allowed range `0`–`3`.                       |
| `GITHUB_CONNECTOR_ENABLED`       | Enables the optional read-only GitHub connector.                             |
| `GITHUB_TOKEN`                   | Server-side read-only GitHub token.                                          |
| `AI_TEST_PLANNING_ENABLED`       | Enables the optional AI planning adapter.                                    |
| `AI_PROVIDER`                    | Must be `openai` for the implemented provider.                               |
| `AI_MODEL`                       | Explicit organisation-approved model available to the API project.           |
| `OPENAI_API_KEY`                 | Server-side OpenAI key. Never expose it in client input.                     |
| `AI_REQUEST_TIMEOUT_MS`          | OpenAI request timeout.                                                      |
| `AI_MAX_INPUT_FILES`             | Maximum repository-fact entries sent to AI.                                  |
| `AI_MAX_INPUT_BYTES`             | Maximum bounded, redacted AI input size.                                     |
| `LOG_LEVEL`                      | Server log level.                                                            |

Restart the web server after changing `.env.local`; runtime configuration is read when the server process starts.

## 1.5 Repository configuration

For one repository:

```env
QA_ALLOWED_REPOSITORY_ROOTS=/absolute/path/to/approved/repository
```

For several approved roots:

```env
QA_ALLOWED_REPOSITORY_ROOTS=/Users/example/work,/srv/read-only-repositories
```

The path entered in the UI must be the allowed root itself or a descendant. Paths are canonicalised, symlinks are resolved, and paths outside the list are rejected.

For strongest containment in Docker, mount repositories read-only. The local connector itself does not write to the target repository.

## 1.6 Target-host configuration

The demo requires:

```env
QA_ALLOWED_TARGET_HOSTS=localhost,127.0.0.1
```

An approved staging target adds its hostname without the scheme, port, or path:

```env
QA_ALLOWED_TARGET_HOSTS=localhost,127.0.0.1,staging.example.internal
```

The URL entered in the UI still includes its scheme:

```text
https://staging.example.internal
```

Only HTTP and HTTPS are accepted. Hostnames containing production markers such as `prod` or `production`, and hosts beginning with `www.`, are denied by default.

## 1.7 Initialise SQLite

```bash
corepack pnpm db:init
```

Expected output resembles:

```text
Initialized QA database at /absolute/path/to/qa-agent-platform/var/qa-platform.db
```

Node 22 may also print an experimental SQLite warning. That warning is expected for this proof of concept.

## 1.8 Optional Docker setup

```bash
docker compose build
docker compose up
```

The Compose deployment:

- exposes the control room at `127.0.0.1:3000`;
- exposes the demo at `127.0.0.1:3100`;
- persists platform data in the `qa-data` volume;
- runs both services as a non-root user;
- mounts `${QA_REPOSITORY_MOUNT:-.}` read-only at `/repositories`.

To scan another local repository in Docker:

```bash
QA_REPOSITORY_MOUNT=/absolute/path/to/approved/repository docker compose up
```

Enter `/repositories` as the local repository path in the UI.

---

# Part 2 — Start the platform

Keep both terminals open.

## Terminal 1 — control room

```bash
corepack pnpm dev:web
```

Expected output includes:

```text
Local: http://localhost:3000
Ready
```

This starts the Next.js control-room UI and internal API on port `3000`.

## Terminal 2 — deterministic demo target

```bash
corepack pnpm dev:demo
```

Expected output includes:

```text
Local: http://localhost:3100
Ready
```

This starts an isolated application used only for safe demonstrations. Its root redirects to `/login`.

## Verify startup

```bash
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:3000/api/readiness
curl -I http://localhost:3100
```

Healthy responses include:

```json
{ "status": "ok", "service": "qa-agent-platform" }
```

```json
{ "status": "ready", "database": "available" }
```

The demo response redirects to `http://localhost:3100/login`.

Open:

```text
http://localhost:3000
```

Do not use port `3100` as the control room. Port `3100` is the application being tested.

Stop either server with `Ctrl+C` in its terminal.

---

# Part 3 — Platform tour

The current UI is one **QA Control Room** with four workspace tabs. There are no separate Settings, Reports, Approvals, Repository Selection, or AI Planning pages; those functions are embedded in the four tabs or exposed through the internal API/filesystem. The `Dashboard` inside the demo target is a page being tested, not a platform administration screen.

## 3.1 Header and safety notice

- **QA Control Room** identifies the platform.
- **Local POC** states that this is the local proof of concept.
- **Safety guardrails active** reminds the operator that production mutation, arbitrary code, and cross-host navigation are blocked.

## 3.2 New QA run

This is the request form.

| Field                                   | What to enter                                                 | What it controls                                                                                       |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Application name**                    | A human-readable target name, for example `Demo target`.      | Report and request identity. A pilot profile requires an exact configured name.                        |
| **Target base URL**                     | Local/test/staging URL, for example `http://localhost:3100`.  | The allowed origin for all Playwright navigation.                                                      |
| **Environment**                         | `Local`, `Test`, or `Staging`.                                | Safety and report metadata.                                                                            |
| **Source mode**                         | `No repository`, `Local repository`, or `GitHub (read only)`. | Whether repository analysis runs before planning.                                                      |
| **Approved local repository path**      | Absolute path beneath `QA_ALLOWED_REPOSITORY_ROOTS`.          | Local read-only scan source; ignored unless Source mode is Local.                                      |
| **GitHub repository**                   | `owner/repository`.                                           | GitHub scan source; ignored unless Source mode is GitHub.                                              |
| **Branch or ref**                       | For example `main`.                                           | GitHub ref or local comparison metadata when supported.                                                |
| **Estimated manual minutes**            | Optional non-negative number.                                 | Reported estimate used to calculate estimated time saved.                                              |
| **QA objective**                        | What the tester wants to verify.                              | Planner input. Required.                                                                               |
| **Existing cases or chat instructions** | Numbered or bulleted cases.                                   | Preserved user cases and rule-based assertions. Leave empty for generated planning.                    |
| **Create candidate plan →**             | Submit after reviewing all input.                             | Validates the request, optionally scans the repository, and creates a plan. It does not execute tests. |

After submission, **Planner conversation** confirms that the request was validated and that execution remains locked.

The `No-AI mode ready` badge means the offline path is available. It is not proof that AI is disabled or that AI handled a particular request. Use case source badges and fallback warnings for that determination.

## 3.3 Test plan

The tab becomes available after planning.

Each case card shows:

- stable case ID, such as `TEST-001`;
- source: `USER`, `REPOSITORY_ANALYSIS`, `AI_SUGGESTED`, or `RULE_BASED`;
- side-effect classification, normally `READ ONLY`;
- title and expected result;
- route;
- inferred assertion type;
- manual-time estimate;
- repository evidence, when mapped;
- validation warnings;
- **Edit case**, **Reject**, and **Approve case** controls.

**Edit case** currently changes only title, route, and expected result. Saving creates a new plan version and invalidates the case approval. It does not provide a rich action-step editor.

**Suggested gaps** are separate proposals. They are labelled **Not added automatically** and cannot execute merely because they were suggested.

The bottom approval bar shows the number of individually approved cases. **Approve plan & queue run →** records approval of the exact plan version, then starts a run.

## 3.4 Run progress

This tab shows:

- run ID and lifecycle status;
- totals for `PASS`, `FAIL`, `BLOCKED`, `NEEDS_HUMAN_REVIEW`, and `NOT_EXECUTED`;
- current phase and current test;
- live progress without a full-page reload;
- **Cancel safely** while a run is active;
- one result row per executed case;
- duration, evidence count, and retry count;
- **Rerun failures** and **Rerun full plan** after completion.

`Rerun failures` selects only prior `FAIL` results. It does not rerun blocked or human-review cases. If there are no failures, the API returns an actionable error.

## 3.5 Results & history

This is the persistent run list, not a separate reporting system.

Each row shows:

- run status;
- full run ID;
- creation time;
- plan version;
- rerun mode: `NONE`, `FULL`, or `FAILURES`.

Select a row to reopen its Run progress/results view. The history is backed by SQLite.

## 3.6 Reports and evidence

The UI announces **Reports generated**, but the current proof of concept does not include report-download or evidence-preview links. Inspect reports through the API or filesystem as described in Parts 10 and 11.

---

# Part 4 — Workflow A: URL + existing test cases

This walkthrough uses the isolated demo because it is deterministic, local, and contains no KOG or production data.

## Step 1 — Open the platform

Open `http://localhost:3000` and select **＋ New QA run**.

## Step 2 — Enter the request

Use:

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| Application name | `Demo login manual cases`                                  |
| Target base URL  | `http://localhost:3100`                                    |
| Environment      | `Local`                                                    |
| Source mode      | `No repository`                                            |
| QA objective     | `Review three supplied login cases against the safe demo.` |

## Step 3 — Paste the requested sample cases

```text
1. Login page loads
2. Invalid credentials show error
3. Valid login opens dashboard
```

Select **Create candidate plan →**.

## Step 4 — Understand the generated plan

The rule-based parser preserves all three sentences, but a sentence title is not automatically a complete multi-step browser script.

Expected plan interpretation:

| Case                             | Expected card                                                                      | Important review decision                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Login page loads`               | Route `/`; assertion `goto`.                                                       | A deterministic navigation check. Safe to approve.                                                                                                                                    |
| `Invalid credentials show error` | Route `/`; assertion `assertTextVisible`; warning that expected text was inferred. | It does not fill credentials or submit the form. Approving it is useful only as an intentional failure demonstration unless its steps were supplied through a structured integration. |
| `Valid login opens dashboard`    | Route `/`; assertion `goto`.                                                       | It does not log in or prove that the dashboard opened. Reject it rather than accepting a misleading navigation-only result.                                                           |

For exact message matching, write the case with quoted text:

```text
Invalid credentials show "Invalid credentials"
```

This improves the expected text but still does not add credential entry and form submission.

## Step 5 — Review and approve

Recommended safe demonstration:

1. Approve `TEST-001`.
2. Optionally approve `TEST-002` only to demonstrate a deterministic `FAIL`.
3. Reject `TEST-003` because its inferred action does not prove its title.
4. Select **Approve plan & queue run →**.

Approval is mandatory because:

- planning input is untrusted data;
- inferred selectors and actions can be incomplete;
- the approved item list and exact plan version are persisted;
- editing a case creates a new version and invalidates its previous approval;
- AI and repository proposals cannot approve themselves.

## Step 6 — What Playwright does

For `TEST-001`, Playwright:

1. launches headless Chromium;
2. opens the approved route on the allowlisted base origin;
3. waits for document load;
4. rejects any cross-origin document navigation;
5. captures the final screenshot, trace, and redacted browser log;
6. records `PASS` only if the configured action completes.

For the optional `TEST-002`, Playwright loads `/` and searches for the inferred text. Since no invalid-login submission occurred, the assertion should fail. That `FAIL` is useful evidence that review matters; it is not a platform malfunction.

## Step 7 — Inspect the result

On **Run progress**:

- `PASS` means every configured deterministic action/assertion completed.
- `FAIL` means Playwright observed a navigation, selector, timeout, or assertion failure.
- `NEEDS_HUMAN_REVIEW` means navigation/screenshot completed without a deterministic assertion.
- Evidence count normally shows three items for a non-sensitive successful case.
- Retry count reflects `QA_ACTION_RETRIES`.

Find the full run ID in **Results & history**, then inspect:

```text
$QA_DATA_DIR/evidence/<run-id>/<test-id>/final.png
$QA_DATA_DIR/evidence/<run-id>/<test-id>/trace.zip
$QA_DATA_DIR/evidence/<run-id>/<test-id>/browser.log
$QA_DATA_DIR/reports/<run-id>/report.json
$QA_DATA_DIR/reports/<run-id>/report.md
$QA_DATA_DIR/reports/<run-id>/report.html
```

---

# Part 5 — Workflow B: repository only

Repository-only planning starts with repository facts and no existing cases.

## Step 1 — Allowlist the repository

In `.env.local`:

```env
QA_ALLOWED_REPOSITORY_ROOTS=/absolute/path/to/qa-agent-platform
```

Restart Terminal 1:

```bash
corepack pnpm dev:web
```

## Step 2 — Create the request

Use:

| Field                          | Value                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Application name               | `Demo repository analysis`                                              |
| Target base URL                | `http://localhost:3100`                                                 |
| Environment                    | `Local`                                                                 |
| Source mode                    | `Local repository`                                                      |
| Approved local repository path | `/absolute/path/to/qa-agent-platform`                                   |
| QA objective                   | `Identify safe read-only smoke checks for the demo application routes.` |
| Existing cases                 | Leave empty                                                             |

Select **Create candidate plan →**.

## Step 3 — Observe repository analysis

The request progresses through queued, scanning, and planning phases. Expand **Repository analysis** on the Test plan screen.

It displays:

- repository identity;
- detected framework;
- package manager;
- commit prefix or `Working tree`;
- number of changed files;
- deterministic risk signals.

The analyzer discovers bounded facts such as:

- Next.js/React/Vue/Svelte dependencies from `package.json`;
- pnpm/npm/yarn lockfile;
- route files;
- component files under component directories;
- existing tests;
- fixed Git branch, commit, status, and optional comparison information;
- risks such as authentication, navigation, form, or missing-test coverage.

## Step 4 — Review candidate cases and evidence

Repository-derived items have source `REPOSITORY_ANALYSIS`. Current route proposals contain:

- a `goto` action;
- a screenshot action;
- repository evidence pointing to the route file;
- a warning to add a deterministic page assertion before approval.

The current UI cannot add detailed action steps. Therefore:

- approve a navigation-only proposal only when a human-review result is useful;
- reject misleading or malformed routes;
- do not interpret successful navigation as proof of business behavior.

## Step 5 — Approve and run

Approve one or two safe route proposals and approve the plan.

Expected result for an unchanged navigation-plus-screenshot proposal:

```text
NEEDS_HUMAN_REVIEW
```

This is correct. Playwright reached the route and captured evidence, but no assertion proved specific content.

The repository remains unchanged. The connector never runs package scripts or repository code.

---

# Part 6 — Workflow C: repository + existing cases

This combines preserved manual knowledge with repository-derived gap suggestions.

## Step 1 — Configure the same demo repository

Use the Workflow B repository allowlist and restart the server after configuration changes.

## Step 2 — Enter the request

| Field                          | Value                                                            |
| ------------------------------ | ---------------------------------------------------------------- |
| Application name               | `Demo combined planning`                                         |
| Target base URL                | `http://localhost:3100`                                          |
| Environment                    | `Local`                                                          |
| Source mode                    | `Local repository`                                               |
| Approved local repository path | `/absolute/path/to/qa-agent-platform`                            |
| QA objective                   | `Preserve manual login checks and identify untested route gaps.` |

Paste:

```text
1. The Login button is visible.
2. The Login button is visible.
3. "Welcome back" is visible.
```

## Step 3 — Generate and review

Expected behavior:

- all three supplied cases remain in the main plan;
- the exact normalised duplicate is marked internally with `duplicateOf`;
- repository proposals appear under **Suggested gaps** and are not added automatically;
- repository evidence appears on repository-derived proposals;
- if AI is enabled and succeeds, AI proposals also remain separate suggestions;
- nothing is approved.

The current UI has no **Add suggestion to plan** control. Suggested gaps are informational in this proof of concept; they cannot be individually approved or executed until an approved integration promotes them into a new plan item. Approve and run only the reviewed items already in the main plan.

The current UI does not show a dedicated duplicate badge. Reject the second duplicate. To inspect duplicate metadata without reading source code, query the latest plan in SQLite:

```bash
PLAN_ID=$(
  node --env-file=.env.local --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.env.QA_DATABASE_PATH);
    const row = db.prepare("SELECT json FROM plans ORDER BY updated_at DESC LIMIT 1").get();
    console.log(JSON.parse(row.json).id);
    db.close();
  '
)

curl -fsS "http://localhost:3000/api/internal/plans/$PLAN_ID" \
  | jq '.data.items[] | {id, title, duplicateOf}'
```

## Step 4 — Approve and run

1. Approve only the non-duplicate cases whose inferred assertion matches the title.
2. Reject the duplicate and any navigation-only claim that overstates what it proves.
3. Approve the exact plan version.
4. Observe deterministic results and evidence.
5. Inspect the report for repository identity, repository commit, plan version, approval, totals, and results.

---

# Part 7 — Workflow D: no existing cases

This workflow uses only a target URL and objective.

## 7.1 Rule-based planning

Set:

```env
AI_TEST_PLANNING_ENABLED=false
AI_PROVIDER=
AI_MODEL=
OPENAI_API_KEY=
```

Restart the web server.

Create a run with:

| Field            | Value                          |
| ---------------- | ------------------------------ |
| Application name | `Demo generated planning`      |
| Target base URL  | `http://localhost:3100`        |
| Environment      | `Local`                        |
| Source mode      | `No repository`                |
| QA objective     | `The Login button is visible.` |
| Existing cases   | Leave empty                    |

The rule-based planner turns the objective into one unapproved candidate with a deterministic button-visibility assertion. The source may display `USER` because the objective is parsed as user-supplied planning input.

Review, approve, run, and inspect the evidence.

## 7.2 Repeat with AI enabled

Configure an approved model and key as described in Part 8, restart the server, and submit the same request.

Compare:

| Outcome                   | What appears                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| AI succeeded              | Primary generated items have source `AI_SUGGESTED`. They remain unapproved.                        |
| AI unavailable or invalid | Items have source `RULE_BASED` and include `AI planning unavailable; rule-based fallback used: …`. |
| AI disabled               | Offline rule-based/user-derived items appear without an AI-fallback warning.                       |

AI suggestions remain unapproved because model output is planning input, not execution authority. A human still reviews individual items and approves the exact plan version.

---

# Part 8 — AI testing

## 8.1 Enable the existing OpenAI adapter

In ignored `.env.local`:

```env
AI_TEST_PLANNING_ENABLED=true
AI_PROVIDER=openai
AI_MODEL=<organisation-approved-accessible-structured-output-model>
OPENAI_API_KEY=<approved-runtime-secret>
```

Do not guess `AI_MODEL`. Ask the organisation’s AI owner for an approved model that the API project can access and that supports strict structured output through Chat Completions.

Do not commit `.env.local`. Do not place the key in `NEXT_PUBLIC_*`, browser fields, repository files, reports, or screenshots.

Restart:

```bash
corepack pnpm dev:web
```

## 8.2 Verify configuration without exposing the key

This prints only presence and safe configuration metadata:

```bash
node --env-file=.env.local -e '
  process.stdout.write(JSON.stringify({
    keyDetected: Boolean(process.env.OPENAI_API_KEY),
    aiEnabled: process.env.AI_TEST_PLANNING_ENABLED === "true",
    provider: process.env.AI_PROVIDER || null,
    modelConfigured: Boolean(process.env.AI_MODEL),
    model: process.env.AI_MODEL || null
  }) + "\n")
'
```

Do not print `process.env.OPENAI_API_KEY`, its length, prefix, suffix, or any substring.

## 8.3 Verify AI is actually used

Create Workflow D with no repository and no existing cases.

AI success indicators:

- the plan completes rather than remaining in a failed phase;
- generated item source badges show `AI_SUGGESTED`;
- there is no `AI planning unavailable` warning;
- each output passed the platform’s strict schema and Zod parsing;
- all items are still unapproved.

Fallback indicators:

- source badge `RULE_BASED`;
- warning begins `AI planning unavailable; rule-based fallback used:`;
- the warning may name missing configuration, provider timeout, model access, length, or schema/Zod parsing failure;
- the plan remains usable through the offline path.

Do not use the static `No-AI mode ready` badge as evidence of which adapter handled a request. It indicates fallback readiness.

## 8.4 What AI can and cannot do

AI can:

- propose bounded read-only cases;
- use redacted objectives/instructions and bounded repository facts;
- propose allowlisted action types;
- provide rationale and evidence-path references.

AI cannot:

- approve a case or plan;
- execute a browser;
- run repository code;
- bypass target or route policy;
- emit a trusted `PASS` or `FAIL`;
- send KOG repository content unless the operator deliberately configures and approves that workflow.

Playwright remains the result authority.

---

# Part 9 — Repository analysis

## 9.1 What is scanned

The local connector:

1. resolves the requested repository to a real directory;
2. verifies it is within `QA_ALLOWED_REPOSITORY_ROOTS`;
3. walks bounded files without following symlinks;
4. reads allowlisted text formats only;
5. skips files larger than `QA_MAX_SCAN_FILE_BYTES`;
6. stops at `QA_MAX_SCAN_FILES`;
7. gathers fixed read-only Git metadata;
8. passes an in-memory snapshot to deterministic analysis.

Text formats include JavaScript/TypeScript, JSX/TSX, JSON, Markdown, CSS/SCSS, HTML, YAML, TOML, text, Vue, and Svelte.

## 9.2 What is not scanned

The connector excludes:

- `.git`;
- `node_modules`;
- `.next`;
- `dist`, `build`, `coverage`, `vendor`, `.cache`, and `out`;
- `.env` and `.env.*`;
- key, certificate, database, and common binary files;
- oversized files;
- symlinks;
- unsupported file extensions.

The GitHub connector is separately feature-gated, reads a bounded selected file set, and requires a server-side token.

## 9.3 Why specific facts are read

| Fact                     | Reason                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `package.json`           | Detect framework dependencies and record scripts as redacted metadata. Scripts are not executed. |
| Lockfiles                | Identify pnpm, npm, or yarn.                                                                     |
| Route files              | Propose route-level smoke checks and cite their source path.                                     |
| Component files          | Describe the frontend surface and potential coverage gaps.                                       |
| Test files               | Identify existing automated coverage.                                                            |
| Git branch/commit/status | Bind evidence to a repository state and identify changed-file risks.                             |
| Optional comparison ref  | Focus changed-file analysis without checking out or modifying a ref.                             |

## 9.4 Why repository code is never executed

The connector invokes only fixed read-only Git commands:

- current branch;
- current commit;
- porcelain status;
- optional changed-file comparison.

It never runs package scripts, build commands, tests, hooks, application code, shell instructions found in files, or AI-suggested commands. Repository contents are treated as untrusted data.

---

# Part 10 — Playwright execution

## 10.1 What Playwright is

Playwright is the browser automation library used by the runner. For each approved case, the platform launches **headless Chromium**. No visible browser window is expected during a normal run.

## 10.2 Supported browser actions

| Category             | Supported actions                                                                     |
| -------------------- | ------------------------------------------------------------------------------------- |
| Navigation           | `goto`                                                                                |
| Interaction          | `click`, `fill`, `selectOption`, `check`, `uncheck`, `press`                          |
| Waiting              | `waitForElement`                                                                      |
| Content assertions   | `assertTextVisible`, `assertExactText`, `assertElementVisible`, `assertElementHidden` |
| State assertions     | `assertElementEnabled`, `assertElementDisabled`, `assertFieldValidation`              |
| URL/title assertions | `assertUrlEquals`, `assertUrlContains`, `assertPageTitle`                             |
| Evidence             | `captureScreenshot`                                                                   |

Allowed selector strategies are role, label, text, test ID, and placeholder. Allowed keyboard presses are Enter, Tab, Escape, Space, ArrowDown, and ArrowUp.

There is no arbitrary JavaScript or shell action.

## 10.3 How results are assigned

- `PASS`: all deterministic configured actions/assertions completed.
- `FAIL`: the final permitted attempt ended in a browser/assertion/selector/navigation/timeout error.
- `BLOCKED`: a safety or side-effect rule prevents execution.
- `NEEDS_HUMAN_REVIEW`: only navigation/screenshot actions completed, with no deterministic assertion.
- `NOT_EXECUTED`: cancellation or run interruption prevented the case from starting/completing.

The model does not assign these statuses.

## 10.4 Evidence files

Normal non-sensitive success:

```text
$QA_DATA_DIR/evidence/<run-id>/<test-id>/final.png
$QA_DATA_DIR/evidence/<run-id>/<test-id>/trace.zip
$QA_DATA_DIR/evidence/<run-id>/<test-id>/browser.log
```

Failed attempts may produce:

```text
failure-attempt-<n>.png
trace-attempt-<n>.zip
browser-attempt-<n>.log
```

Browser logs are bounded and redacted.

When a case uses authentication state or a redacted value:

- screenshot and trace metadata are retained as unavailable;
- the reason explains sensitive-state suppression;
- browser log content is replaced with a redaction marker.

This is expected security behavior.

## 10.5 Open evidence

macOS:

```bash
open "$QA_DATA_DIR/evidence/<run-id>/<test-id>/final.png"
open "$QA_DATA_DIR/reports/<run-id>/report.html"
```

Linux:

```bash
xdg-open "$QA_DATA_DIR/evidence/<run-id>/<test-id>/final.png"
xdg-open "$QA_DATA_DIR/reports/<run-id>/report.html"
```

Trace viewer:

```bash
corepack pnpm exec playwright show-trace \
  "$QA_DATA_DIR/evidence/<run-id>/<test-id>/trace.zip"
```

Browser log:

```bash
sed -n '1,200p' \
  "$QA_DATA_DIR/evidence/<run-id>/<test-id>/browser.log"
```

## 10.6 Reruns

- **Rerun full plan** creates a child run for every approved case.
- **Rerun failures** creates a child run containing only prior `FAIL` cases.
- History preserves `parentRunId`, plan version, and rerun mode.
- The same approval and safety rules still apply.

---

# Part 11 — Reports, history, evidence, and SQLite

## 11.1 JSON report

Path:

```text
$QA_DATA_DIR/reports/<run-id>/report.json
```

Use for machines and detailed inspection. It includes:

- run/application/environment;
- redacted target URL;
- objective;
- repository identity and commit when applicable;
- exact plan version and approval;
- totals;
- automated duration;
- estimated manual duration and estimated time saved;
- coverage/estimate notices;
- result and evidence metadata.

Fetch the same JSON through the API:

```bash
curl -fsS \
  "http://localhost:3000/api/internal/runs/<run-id>/report" \
  | jq .data
```

## 11.2 Markdown report

Path:

```text
$QA_DATA_DIR/reports/<run-id>/report.md
```

This is the review-friendly text report with totals, per-case expected/actual results, durations, retries, and evidence paths.

## 11.3 HTML report

Path:

```text
$QA_DATA_DIR/reports/<run-id>/report.html
```

This is a locally viewable rendering of the Markdown report. It is not a hosted or externally shared report.

## 11.4 History

**Results & history** reads persisted run JSON from SQLite and orders recent runs by update time. Select a row to reopen the run.

## 11.5 Evidence

Evidence files live on the filesystem. SQLite stores safe evidence metadata and paths, not the screenshot/trace bytes.

## 11.6 SQLite

Default configured path:

```text
$QA_DATABASE_PATH
```

Tables:

- `requests`;
- `scans`;
- `plans`;
- `approvals`;
- `runs`;
- `audit_events`.

List recent runs using Node’s built-in SQLite API:

```bash
node --env-file=.env.local --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(process.env.QA_DATABASE_PATH);
  console.table(
    db.prepare(
      "SELECT id, status, created_at, updated_at FROM runs ORDER BY updated_at DESC LIMIT 10"
    ).all()
  );
  db.close();
'
```

Do not edit rows manually. Plans, approvals, audit events, and rerun lineage depend on consistent records.

---

# Part 12 — Troubleshooting

| Symptom                            | Likely cause                                                                                  | What to do                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform will not start            | Unsupported Node, dependencies missing, port busy, or invalid environment value               | Run `node --version`, `corepack pnpm install --frozen-lockfile`, and `lsof -nP -iTCP:3000 -sTCP:LISTEN`. Correct `.env.local`, then restart.     |
| `db:init` fails                    | Invalid/unwritable database path                                                              | Use an absolute writable `QA_DATABASE_PATH`; ensure its parent directory is writable.                                                            |
| Readiness returns 503              | SQLite cannot be opened/read                                                                  | Check `QA_DATABASE_PATH`, permissions, free disk space, and server logs.                                                                         |
| Playwright/Chromium missing        | Browser binary was not installed                                                              | Run `corepack pnpm exec playwright install chromium`.                                                                                            |
| Browser will not launch            | Missing OS libraries, low shared memory, or sandbox constraints                               | Reinstall Chromium; for Docker keep `shm_size: 1gb`; inspect server output.                                                                      |
| Repository rejected: no root       | `QA_ALLOWED_REPOSITORY_ROOTS` empty                                                           | Add an approved absolute root and restart the web server.                                                                                        |
| Repository rejected: outside roots | Entered path is not the root or descendant after realpath/symlink resolution                  | Correct the allowlist or choose an approved repository. Do not broaden it to the entire home directory.                                          |
| Repository scan stops early        | File-count or per-file byte limit reached                                                     | Review scan warnings; increase limits only with approval.                                                                                        |
| Target URL blocked                 | Host absent from `QA_ALLOWED_TARGET_HOSTS`, protocol unsupported, or production-like hostname | Add only the approved local/test/staging hostname and restart. Never bypass production denial.                                                   |
| Cross-origin navigation blocked    | A click/redirect left the approved base origin                                                | Correct the test or target configuration; do not allowlist an unrelated external host merely to make the case pass.                              |
| `NEEDS_HUMAN_REVIEW`               | Case has navigation/screenshot but no deterministic assertion                                 | Inspect evidence, then supply a case with a supported assertion through an approved structured integration. Do not call it a pass.               |
| AI disabled                        | Feature flag false or server not restarted                                                    | Set all four AI variables, then restart.                                                                                                         |
| AI fallback                        | Missing configuration, inaccessible model, provider error, timeout, or invalid output         | Read the redacted case warning. Confirm key presence without printing it and verify the approved model’s account access.                         |
| OpenAI timeout                     | `AI_REQUEST_TIMEOUT_MS` too low or provider/network delay                                     | Retry only under the team’s cost policy; use the rule-based path while blocked.                                                                  |
| Zod/structured-output failure      | Provider output did not match the strict schema or completed incompletely                     | The platform falls back. Do not bypass parsing or trust raw output. Confirm model support and token limits before another controlled validation. |
| Selector ambiguity                 | More than one element matches a semantic locator                                              | Refine the approved plan through a structured step editor/integration. Preserve the failure evidence.                                            |
| Report missing                     | Run not completed, reporting failed, or looking under the wrong data directory                | Check run status, `$QA_DATA_DIR`, server working configuration, and `GET /api/internal/runs/<id>/report`.                                        |
| Screenshot/trace unavailable       | Case used authentication or redacted values                                                   | Expected suppression. Inspect safe result/report metadata and the redaction marker instead.                                                      |
| Rerun failures errors              | Parent has no `FAIL` results                                                                  | Use full rerun if appropriate; human-review and blocked cases are not failure-rerun inputs.                                                      |
| Docker build fails                 | Network, registry, disk, or Docker daemon issue                                               | Run `docker info`, check disk space and registry access, then `docker compose build`.                                                            |
| Docker repository rejected         | Host path not mounted or `/repositories` not allowlisted                                      | Set `QA_REPOSITORY_MOUNT`, recreate containers, and use `/repositories` in the UI.                                                               |

---

# Part 13 — Controlled KOG staging pilot

KOG access is an external dependency. This repository contains no real KOG URL, selectors, credentials, repository path, or business data. Do not invent them.

The existing profile is disabled:

```text
config/pilots/kog-agent2.disabled.json
```

## 13.1 Required approvals and inputs

Before continuing, obtain:

- approved non-production KOG base URL and hostname;
- approved read-only repository path/mount;
- five reviewed read-only cases and expected visible labels/routes;
- allowed route prefixes;
- prohibited browser actions;
- an approved Playwright storage-state file or test credential variables;
- retention period from 1 to 90 days;
- permission to access staging with the selected test identity.

## 13.2 Create an environment-specific pilot profile

Copy the disabled profile to an environment-specific JSON file under the allowed configuration root. Do not commit a file containing organisation-specific details unless the organisation explicitly approves it.

```bash
cp \
  config/pilots/kog-agent2.disabled.json \
  config/pilots/kog-agent2.staging.json
```

Example structure:

```json
{
  "schemaVersion": "qa-pilot-configuration/v1",
  "enabled": true,
  "application": {
    "name": "kog-agent2"
  },
  "environment": {
    "kind": "STAGING",
    "baseUrlEnv": "KOG_AGENT2_BASE_URL",
    "expectedHost": "approved-kog-staging-host.example"
  },
  "source": {
    "mode": "LOCAL",
    "repositoryPathEnv": "KOG_AGENT2_REPOSITORY_PATH"
  },
  "auth": {
    "adapter": "playwright-storage-state",
    "storageStateEnv": "KOG_STORAGE_STATE_PATH"
  },
  "safety": {
    "permittedRoutes": ["/", "/approved-read-only-area"],
    "prohibitedActions": ["click", "fill", "selectOption", "check", "uncheck", "press"],
    "allowProductionMutation": false,
    "allowExternalSideEffects": false
  },
  "retention": {
    "artifactDays": 14
  }
}
```

`expectedHost` is only the hostname. `permittedRoutes` must match the reviewed first-five cases.

`retention.artifactDays` is validated metadata. The current proof of concept does not automatically delete expired artifacts, so the pilot operator must apply the approved cleanup/retention process outside the platform.

## 13.3 Configure runtime values

In the approved secret/runtime mechanism:

```env
QA_ALLOWED_TARGET_HOSTS=localhost,127.0.0.1,approved-kog-staging-host.example
QA_ALLOWED_REPOSITORY_ROOTS=/absolute/read-only/repository-parent
QA_ALLOWED_CONFIGURATION_ROOTS=/absolute/path/to/qa-agent-platform/config/pilots

KOG_AGENT2_BASE_URL=https://approved-kog-staging-host.example
KOG_AGENT2_REPOSITORY_PATH=/absolute/read-only/repository-parent/kog-repository
KOG_STORAGE_STATE_PATH=/absolute/secure/path/kog-storage-state.json
```

The repository path and storage state are resolved on the server. They are not stored in the profile.

Create storage state outside the repository only if permitted:

```bash
corepack pnpm exec playwright codegen \
  --save-storage=/absolute/secure/path/kog-storage-state.json \
  "$KOG_AGENT2_BASE_URL"
chmod 600 /absolute/secure/path/kog-storage-state.json
```

Complete authentication manually in the opened browser. Storage state may contain live cookies; never commit or share it.

Alternatively, the implemented `environment-credentials` adapter accepts environment-variable names for email/password plus reviewed login labels and route. Use it only for an approved non-production test account.

Restart the web server after configuration.

## 13.4 Prepare five safe cases

Use only approved, non-mutating observations. Replace every placeholder below with a reviewed KOG staging fact:

```text
1. KOG staging page loads /
2. "<approved page heading>" is visible
3. "<approved navigation label>" is visible
4. "<approved read-only status label>" is visible
5. Page loads /<approved-read-only-route>
```

Do not approve a placeholder. Do not add clicks, fills, submissions, downloads, uploads, emails, exports, deletions, or state changes to the first five checks.

## 13.5 Create the profile-bound request

The current UI does not expose `configurationFile`, so start a controlled pilot through the internal API. Load local environment values without shell tracing:

```bash
set +x
set -a
source .env.local
set +a
```

Create the request:

```bash
REQUEST_RESPONSE=$(
  jq -n \
    --arg base "$KOG_AGENT2_BASE_URL" \
    --arg repo "$KOG_AGENT2_REPOSITORY_PATH" \
    --arg config "$(pwd)/config/pilots/kog-agent2.staging.json" \
    --arg cases '1. KOG staging page loads /
2. "<approved page heading>" is visible
3. "<approved navigation label>" is visible
4. "<approved read-only status label>" is visible
5. Page loads /<approved-read-only-route>' \
    '{
      workflow: "REPOSITORY_WITH_CASES",
      applicationName: "kog-agent2",
      baseUrl: $base,
      environment: "STAGING",
      objective: "Execute five approved read-only KOG staging checks",
      source: {
        schemaVersion: "repository-source/v1",
        mode: "LOCAL",
        localPath: $repo
      },
      existingCasesText: $cases,
      configurationFile: $config,
      estimatedManualMinutes: 15
    }' \
  | curl -fsS \
      -H 'Content-Type: application/json' \
      -d @- \
      http://localhost:3000/api/internal/requests
)

REQUEST_ID=$(printf '%s' "$REQUEST_RESPONSE" | jq -r '.data.id')
printf 'Request: %s\n' "$REQUEST_ID"
```

Queue scan and planning:

```bash
curl -fsS \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "http://localhost:3000/api/internal/requests/$REQUEST_ID/scan" \
  | jq .
```

Poll without printing secrets:

```bash
while true; do
  WORKSPACE=$(
    curl -fsS \
      "http://localhost:3000/api/internal/requests/$REQUEST_ID"
  )
  PHASE=$(printf '%s' "$WORKSPACE" | jq -r '.data.events[-1].phase')
  printf 'Phase: %s\n' "$PHASE"
  case "$PHASE" in
    waiting-for-approval) break ;;
    blocked|failed) printf '%s' "$WORKSPACE" | jq '.data.events[-1]'; exit 1 ;;
  esac
  sleep 1
done

PLAN_ID=$(printf '%s' "$WORKSPACE" | jq -r '.data.plan.id')
printf '%s' "$WORKSPACE" \
  | jq '.data.plan.items[] | {id, title, route, source, warnings: .validationWarnings}'
```

Stop if any title, route, selector intent, or warning does not match the approved five checks.

## 13.6 Approve exactly five safe cases

Approve each reviewed item:

```bash
for TEST_ID in $(printf '%s' "$WORKSPACE" | jq -r '.data.plan.items[:5][].id'); do
  curl -fsS \
    -H 'Content-Type: application/json' \
    -d '{"decision":"approve"}' \
    "http://localhost:3000/api/internal/plans/$PLAN_ID/items/$TEST_ID/decision" \
    >/dev/null
done
```

Approve the exact plan version:

```bash
curl -fsS \
  -H 'Content-Type: application/json' \
  -d '{"stagingApprovedItemIds":[]}' \
  "http://localhost:3000/api/internal/plans/$PLAN_ID/approve" \
  | jq '.data.approval'
```

The empty staging list is correct only when all five items are `READ_ONLY`.

## 13.7 Run and inspect

```bash
RUN_RESPONSE=$(
  curl -fsS \
    -H 'Content-Type: application/json' \
    -d '{}' \
    "http://localhost:3000/api/internal/plans/$PLAN_ID/run"
)
RUN_ID=$(printf '%s' "$RUN_RESPONSE" | jq -r '.data.id')
printf 'Run: %s\n' "$RUN_ID"

while true; do
  RUN=$(curl -fsS "http://localhost:3000/api/internal/runs/$RUN_ID")
  STATUS=$(printf '%s' "$RUN" | jq -r '.data.status')
  printf 'Status: %s\n' "$STATUS"
  case "$STATUS" in
    COMPLETED|FAILED|CANCELLED) break ;;
  esac
  sleep 1
done

printf '%s' "$RUN" \
  | jq '.data.results[] | {testId, status, actualResult, retryCount, evidence}'
```

The run also appears in **Results & history**.

For authenticated pilot cases, screenshots and traces are suppressed by design. Inspect safe result metadata, unavailable reasons, the redacted log marker, JSON/Markdown/HTML reports, approval, plan version, and repository commit.

## 13.8 What not to test

Do not test:

- production;
- real customer data;
- write/update/delete operations;
- form submissions that create records;
- external messages, emails, notifications, payments, or exports;
- uploads/downloads unless separately reviewed;
- unrestricted clicks or scripts;
- repository modification;
- automatic fixes;
- routes outside the pilot allowlist;
- actions prohibited by the profile.

If KOG staging access, repository access, selectors, or authentication are missing, stop and record that dependency. A demo result is not KOG evidence.

---

# Part 14 — Architecture walkthrough

```text
User
  ↓
QA Control Room UI
  ↓
Validated Internal API
  ↓
Orchestrator
  ├─→ Repository Connector and Analyzer
  ├─→ Rule-based / optional AI Planner
  ├─→ Approval Gate
  └─→ Playwright Runner
          ↓
     Evidence and Reports
          ↓
        SQLite
```

| Component            | Purpose                                     | Input                                                 | Output                                            | Why it exists                                                              |
| -------------------- | ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| User                 | Supplies intent and makes safety decisions. | URL, objective, cases, repository choice.             | Per-case decisions and exact-plan approval.       | Automation must not self-authorise.                                        |
| QA Control Room UI   | Presents the workflow.                      | Form input and user actions.                          | Validated API requests and visible progress.      | Gives testers a practical interface without source-code access.            |
| Internal API         | Translates HTTP into typed operations.      | JSON validated with Zod.                              | `{data: …}` or redacted `{error: …}`.             | Rejects malformed/unbounded input at the boundary.                         |
| Orchestrator         | Coordinates lifecycle and persistence.      | Request, scan, plan, decisions, run commands.         | Versioned plans, jobs, runs, audit events.        | Keeps workflow order and approval invariants in one place.                 |
| Repository connector | Reads an approved repository safely.        | Local path or feature-gated GitHub source.            | Bounded file snapshot and Git metadata.           | Grounds planning without executing repository code.                        |
| Repository analyzer  | Extracts deterministic facts.               | Repository snapshot.                                  | Framework/routes/components/tests/risks/evidence. | Separates facts from model guesses.                                        |
| Planner              | Builds candidate cases.                     | Objective, existing cases, optional repository facts. | Unapproved items and separate suggestions.        | Preserves offline operation and permits optional structured AI assistance. |
| Approval gate        | Records human decisions.                    | Individual approvals/rejections and plan version.     | Exact-version approval record.                    | Prevents silent plan changes or self-approval.                             |
| Playwright runner    | Executes approved browser actions.          | Approved items, base URL, auth adapter.               | Deterministic results and evidence metadata.      | Makes browser observation—not AI—the result authority.                     |
| Evidence store       | Retains browser artifacts.                  | Screenshots, traces, redacted logs.                   | Per-run/per-test files.                           | Makes failures and passes inspectable.                                     |
| Reporting            | Summarises one completed run.               | Request, plan, approval, results, analysis.           | JSON, Markdown, and HTML.                         | Serves machine, reviewer, and browser-readable consumers.                  |
| SQLite               | Persists control-plane history.             | Requests, scans, plans, approvals, runs, audits.      | Durable local history and rerun lineage.          | Keeps exact plan versions and decisions across UI navigation/restarts.     |

---

# Part 15 — Final verification checklist

## Setup and startup

- [ ] Node is 22.5 or newer.
- [ ] Dependencies were installed with frozen lockfile.
- [ ] Chromium was installed.
- [ ] `.env.local` is ignored and contains no committed secret.
- [ ] `QA_DATA_DIR` and `QA_DATABASE_PATH` are absolute and consistent.
- [ ] Database initialisation succeeds.
- [ ] Control room is Ready on port 3000.
- [ ] Demo is Ready on port 3100.
- [ ] Health reports `ok`.
- [ ] Readiness reports database `available`.

## Core tester journey

- [ ] Start platform.
- [ ] Start demo.
- [ ] Create a candidate plan.
- [ ] Review every item, warning, route, and assertion.
- [ ] Reject duplicates or misleading interpretations.
- [ ] Approve individual cases.
- [ ] Approve the exact plan version.
- [ ] Execute approved cases.
- [ ] View deterministic results.
- [ ] Open Results & history.
- [ ] Inspect JSON, Markdown, and HTML reports.
- [ ] Inspect screenshots for a non-sensitive case.
- [ ] Open a Playwright trace for a non-sensitive case.
- [ ] Inspect a redacted browser log.
- [ ] View SQLite run history.
- [ ] Perform a full rerun.
- [ ] Perform a failure-only rerun when a `FAIL` exists.

## Workflow coverage

- [ ] Complete Workflow A: URL + existing cases.
- [ ] Complete Workflow B: repository only.
- [ ] Confirm navigation-only repository proposals become `NEEDS_HUMAN_REVIEW`.
- [ ] Complete Workflow C: repository + existing cases.
- [ ] Inspect duplicate metadata and repository/AI suggestions separately.
- [ ] Complete Workflow D with rule-based planning.
- [ ] Enable AI with an approved model/key.
- [ ] Confirm `AI_SUGGESTED` on a successful AI plan.
- [ ] Confirm a safe `RULE_BASED` fallback and redacted warning on provider failure.

## Safety

- [ ] Target host is explicitly allowlisted.
- [ ] Target is local/test/staging, not production.
- [ ] Repository path is beneath an approved root.
- [ ] Repository remains unchanged after scan.
- [ ] No secret appears in UI input, logs, SQLite, evidence, or reports.
- [ ] Cross-origin navigation remains blocked.
- [ ] AI suggestions remain unapproved.
- [ ] Playwright remains the only PASS/FAIL authority.
- [ ] Sensitive authenticated artifacts are suppressed.

## KOG staging pilot

- [ ] Approved staging URL and expected hostname supplied.
- [ ] Approved read-only repository path mounted/configured.
- [ ] Enabled JSON profile remains within the allowed configuration root.
- [ ] Permitted routes and prohibited actions reviewed.
- [ ] Storage state or test credentials supplied through the approved secret mechanism.
- [ ] Five real, reviewed read-only cases replace all placeholders.
- [ ] Each case and the exact plan version approved.
- [ ] Run results and reports inspected.
- [ ] No production, customer, mutation, or external-side-effect test performed.
- [ ] Any missing external dependency recorded instead of inventing a result.

The local demonstration is ready when all applicable non-KOG items are checked. The KOG item is complete only after the named staging dependencies are supplied and the controlled run is performed against KOG; the demo fallback does not satisfy it.
