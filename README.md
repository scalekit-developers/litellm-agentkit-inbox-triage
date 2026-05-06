# Inbox Triage Agent — LiteLLM + Scalekit AgentKit

An end-to-end sample that triages a Gmail inbox, routes each thread to a GitHub repository, and **waits for human approval** before filing an issue and sending a reply. It is aimed at **evaluators** who want a **runnable** path across **AgentKit** (OAuth + tool execution) and the **Scalekit-hosted LiteLLM gateway** (`llm.scalekit.cloud`).

---

## Who this is for

You want to **run the happy path locally** (Gmail → dashboard proposal → approve → GitHub issue + Gmail reply + Slack update) and **understand the moving parts quickly**—without treating this repo as a production system.

**Rough time and spend (typical):**

- **First successful run:** about **30–45 minutes** if you are creating a Scalekit project, three AgentKit connections, and a virtual LiteLLM API key for the first time (most of that is clicking through OAuth consent in Gmail, GitHub, and Slack).
- **LiteLLM usage:** put a **small budget on the order of USD ~$2** on the virtual API key in the dashboard. That is usually **enough to explore** classification, routing, GitHub issue research, and drafting across **a handful of threads** (actual burn varies by model choice in `routing.yaml`, thread length, and tool-call retries).

---

## How it works

| Layer | What it does here |
|---|---|
| **Scalekit AgentKit** | OAuth and tool calls for Gmail, GitHub, and Slack under one **opaque user identifier**—your code does not manage refresh tokens or per-provider OAuth apps. |
| **LiteLLM** (`llm.scalekit.cloud`) | Each pipeline stage calls the gateway with a **stage-specific model** from `routing.yaml`—cheap/fast for classification and research, heavier models for drafting—without embedding upstream provider keys in this app. |

The process is **polling-based**: on an interval, the app pulls new Gmail threads, runs LLM stages + deterministic routing, stores a **pending proposal** in SQLite, posts to Slack, and serves a **localhost** dashboard for approve/reject.

```
Gmail poll
  │
  ├─[classify]   model from routing.yaml  →  { category, severity, keywords }
  ├─[route]      keyword match against routing.yaml
  ├─[research]   model + github_search_issues (tool loop)
  ├─[tiebreak]   model (only when multiple repos tie)
  ├─[draft]      model (stronger model for security/legal categories)
  ├─[notify]     Slack message with proposal summary
  └─[dashboard]  http://localhost:3000  →  Approve: file issue + send reply + update Slack
                                         Reject: discard (no side effects)
```

Stage → model mapping lives entirely in **`routing.yaml`**; the code reads those names at startup.

---

## Scalekit documentation

Use these **canonical** guides while you configure the dashboard:

| Topic | Documentation |
|---|---|
| AgentKit overview | [AgentKit overview](https://docs.scalekit.com/agentkit/overview.md) |
| Create connections | [Configure a connection](https://docs.scalekit.com/agentkit/connections.md) |
| OAuth scopes | [Scopes and permissions](https://docs.scalekit.com/agentkit/authentication/scopes-permissions.md) |
| GitHub connector | [GitHub](https://docs.scalekit.com/agentkit/connectors/github.md) |
| Gmail connector | [Gmail](https://docs.scalekit.com/agentkit/connectors/gmail.md) |
| Slack connector | [Slack](https://docs.scalekit.com/agentkit/connectors/slack.md) |
| Authorization links | [Authorize a user](https://docs.scalekit.com/agentkit/tools/authorize.md) |
| **Cookbook (this flow on docs.scalekit.com)** | [Triage a Gmail inbox with AgentKit and the LiteLLM gateway](https://docs.scalekit.com/cookbooks/litellm-agentkit-inbox-triage/) |

To discover **additional** stable URLs (or verify paths after docs moves), use the public sitemap: [https://docs.scalekit.com/sitemap-0.xml](https://docs.scalekit.com/sitemap-0.xml) *(if that URL returns an error, open [docs.scalekit.com](https://docs.scalekit.com) and search from there).*

---

## Prerequisites

- **Node.js ≥ 24** (this sample uses built-in `node:sqlite`).
- A **[Scalekit](https://app.scalekit.com) account** and permission to create a project.
- **Google, GitHub, and Slack** identities you can use for OAuth (workspace policies allowing those apps).
- **`curl`** (or any HTTP client) to sanity-check the LiteLLM gateway.

This flow expects an **interactive terminal** (stdin “press Enter” between connector authorizations). **Headless CI** is **out of scope** for this demo.

---

## Quick start

### 1. Create a Scalekit project and AgentKit connections

1. Sign up at [app.scalekit.com](https://app.scalekit.com) and create a project.
2. Under **AgentKit → Connections**, create **three** connections: **Gmail**, **GitHub**, and **Slack**.
3. Copy the exact **Connection name** for each (it can differ from the slug, e.g. `gmail-prod` instead of `gmail`). You will paste those into `.env`.

**GitHub OAuth scopes (important):** when you configure the **GitHub** connection, ensure the granted OAuth scopes include **`repo`** (or the dashboard equivalent your org uses for **repository read/write**, including private repos you expect to triage). Without sufficient repository scope, issue search, issue create, or updates can fail in ways that look like “random” tool errors. See [Scopes and permissions](https://docs.scalekit.com/agentkit/authentication/scopes-permissions.md) and the [GitHub connector](https://docs.scalekit.com/agentkit/connectors/github.md) if your dashboard labels differ from the classic `repo` scope name.

4. Copy your **Environment URL**, **Client ID**, and **Client Secret** from project settings.

### 2. Create a LiteLLM (LLM Gateway) virtual API key

In the Scalekit dashboard, open **LLM Gateway** and create a **virtual API key**. Attach a **small spend limit** if your team uses budgets—for a first pass, **~USD $2** on the key is usually enough to run several end-to-end threads.

Verify the gateway responds:

```bash
curl -H "Authorization: Bearer $LITELLM_API_KEY" \
     https://llm.scalekit.cloud/v1/models
```

You should see model IDs in the JSON. Align the names under `routing.yaml` → `models:` with what this endpoint returns.

### 3. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your values
```

**Secrets:** keep `.env` out of git and off screen recordings. Never commit real credentials.

```
SCALEKIT_ENV_URL=https://your-project.scalekit.cloud
SCALEKIT_CLIENT_ID=skc_...
SCALEKIT_CLIENT_SECRET=sks_...

# Exact Connection names from AgentKit → Connections
GMAIL_CONNECTION_NAME=gmail
GITHUB_CONNECTION_NAME=github
SLACK_CONNECTION_NAME=slack

LITELLM_BASE_URL=https://llm.scalekit.cloud
LITELLM_API_KEY=sk-...
```

On first run the app creates **`DATA_DIR/identifier.txt`** with a stable UUID. That value ties Gmail, GitHub, and Slack to the **same logical user**. **Do not delete or edit** that file casually—doing so **orphans** prior connector authorizations for this data directory.

### 4. Install dependencies and run

```bash
npm install
npm run dev
```

**First run — connector authorization:** the CLI walks **Gmail → GitHub → Slack** in order. For each connector it prints a **magic link**. Open it in a browser, complete OAuth, return to the terminal, and press **Enter** when prompted.

The HTTP dashboard **does not come up until all three connectors report active**. In `src/index.ts`, `setupConnectors(...)` finishes **before** the Express server binds to `localhost`. Wait for:

```
All connectors active.
poller started  {"intervalMs":5000}
dashboard listening on http://localhost:3000
```

Only then is **`http://localhost:3000`** guaranteed to be listening.

### 5. Generate a test email while the app is running

With `npm run dev` still running, **send any email** to the Gmail account you connected—even a short “test” message to yourself. The poller runs on **`POLL_INTERVAL_MS`** (default 5 s). Within roughly one interval you should see log lines for **processing thread** followed by Slack + a pending row in the dashboard.

You do **not** need a special subject line for the first smoke test; routing is driven by your **`routing.yaml`** keywords plus the classifier output.

### 6. Approve or reject in the dashboard

Open **`http://localhost:3000`**. A card shows classification, routed repo, related issues, and drafts.

- **Approve:** creates the GitHub issue (if enabled), sends the Gmail reply (if enabled), updates Slack.
- **Reject:** marks the proposal rejected; **no** GitHub issue and **no** email send.

---

**Extending the sample:** to add repos, connectors, or pipeline stages after you have the baseline running, continue with [COOKBOOK.md](./COOKBOOK.md).

---

## Configuration reference

### `routing.yaml`

```yaml
models:
  classify: claude-haiku-4-5
  research: claude-haiku-4-5
  tiebreak: claude-sonnet-4-6
  draft_default: claude-sonnet-4-6
  draft_sensitive: claude-opus-4-6   # when category is security or legal

repos:
  - name: owner/repo
    keywords: [keyword1, keyword2]
    labels: [label1, label2]
    slack_channel: "#channel-or-user-id"

default:
  name: owner/fallback-repo
  labels: [needs-triage]
  slack_channel: "#triage"
```

### `.env` variables

| Variable | Description |
|---|---|
| `SCALEKIT_ENV_URL` | Your Scalekit environment URL |
| `SCALEKIT_CLIENT_ID` | OAuth client ID |
| `SCALEKIT_CLIENT_SECRET` | OAuth client secret |
| `GMAIL_CONNECTION_NAME` | Exact Connection name for Gmail |
| `GITHUB_CONNECTION_NAME` | Exact Connection name for GitHub |
| `SLACK_CONNECTION_NAME` | Exact Connection name for Slack |
| `LITELLM_BASE_URL` | LiteLLM gateway URL (default `https://llm.scalekit.cloud`) |
| `LITELLM_API_KEY` | Virtual API key from the dashboard |
| `POLL_INTERVAL_MS` | Gmail poll interval in ms (default `5000`) |
| `PORT` | Dashboard port (default `3000`) |
| `DATA_DIR` | SQLite directory (default `./data`) |
| _(file `identifier.txt`)_ | Auto-created UUID under `DATA_DIR`; ties connectors—**do not rotate casually** |

---

## Project layout

```
src/
  index.ts           Entry — connector auth, poller, web server
  config.ts          Env + routing.yaml validation
  tools/
    auth.ts          Per-connector authorization helpers
    agentkit.ts      Thin wrapper around executeTool
  lib/
    litellm.ts       OpenAI-compatible client → gateway
    log.ts           Pino logger
  store/
    schema.sql       SQLite schema
    db.ts            Database access
  pipeline/
    ingest.ts        Gmail polling + cursor
    classify.ts      Classification stage
    route.ts         Keyword routing
    research.ts      GitHub issue search loop
    tiebreak.ts      LLM tiebreak
    draft.ts         Issue + reply drafting
    notify.ts        Slack notification
    act.ts           Approve actions (issue + reply + Slack)
  web/
    server.ts        REST API + static UI
    views/           Dashboard (vanilla JS)
```

---

## How AgentKit and LiteLLM split responsibility

**AgentKit:** `client.actions.executeTool(...)` runs provider tools with Scalekit-managed tokens. Your process passes a **connector** name, **tool** name, **tool input**, and the same **identifier** string for Gmail, GitHub, and Slack.

**LiteLLM:** `src/lib/litellm.ts` issues `chat.completions` calls to `LITELLM_BASE_URL` using `LITELLM_API_KEY`. Each stage selects a model alias from `routing.yaml`. For `category: security` or `category: legal`, the draft stage uses `draft_sensitive` instead of `draft_default`.

---

## Common issues

- **Connection name mismatch:** `GMAIL_CONNECTION_NAME` / `GITHUB_CONNECTION_NAME` / `SLACK_CONNECTION_NAME` must equal the **Connection name** in the dashboard, not a guess like `gmail` unless that is literally what you created.
- **GitHub failures:** confirm the GitHub connection includes repository scope appropriate for **private** repos (see **`repo`** note above).
- **Model not found:** re-run the `curl .../v1/models` check and update `routing.yaml` model strings to match gateway IDs.
- **Dashboard never loads:** wait until logs show **All connectors active**—the server starts only after all three OAuth flows succeed.

Deeper extension and debugging patterns live in [COOKBOOK.md](./COOKBOOK.md).

---

## This demo vs. what you would harden later

Use a **single** checklist for both “what the sample does today” and “what you would change before production.”

| **Demo behavior today** | **What you would harden for real workloads** |
|---|---|
| One **opaque identifier** per `DATA_DIR`; single-operator mental model | **Per-tenant identifiers**, rotation policies, and auditable mapping to real users |
| **SQLite** on local disk | Managed database, backups, encryption at rest, retention policy |
| **Poll Gmail** on a fixed interval | Webhooks or history APIs where available; idempotency and backoff |
| **localhost-only** Express listener | Authenticated hosted UI, TLS, CSRF/session controls, network segmentation |
| Secrets in **`.env`** | Secret manager, short-lived credentials, separate config per environment |
| Broad **Slack + email side effects** after one click | Role-based approval, dry-run mode, second-person review for external replies |
| English-centric prompts and fixtures | Internationalization, redaction rules, attachment policies |

---

## Security notes

- **`.env`** holds live credentials; treat it like production secrets.
- **`identifier.txt`** is a durable join key across connectors for this data directory—treat loss or manual edits as a **security and availability** incident for that operator.
- The dashboard binds to **`localhost`** by default—remote access requires an explicit tunnel or code change; do not expose it unintentionally.
- **SQLite** stores thread metadata and proposal payloads from Gmail—encrypt disk or wipe `DATA_DIR` on shared machines.

---

## Next steps

See [COOKBOOK.md](./COOKBOOK.md) for recipes (new connector, new repo row, swap models, add a pipeline stage).

---

## License

This repository does **not** currently include a `LICENSE` file. Add one before you redistribute or fork publicly.

---

Run `npm test` and `npm run typecheck` to validate changes locally (tests mock AgentKit and LiteLLM; no network).
