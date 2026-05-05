# Inbox Triage Agent — LiteLLM + Scalekit AgentKit

An end-to-end agentic workflow that triages a Gmail inbox, routes each thread to the right GitHub repository, and waits for human approval before filing an issue and sending a reply.

**What you get from this combination:**

| Layer | What it does here |
|---|---|
| **Scalekit AgentKit** | Delegates OAuth access to Gmail, GitHub, and Slack under a single user identifier — no manual token management, no separate app registrations per tool |
| **LiteLLM** (`llm.scalekit.cloud`) | Routes each pipeline stage to a different model — cheap/fast for classification, powerful for drafting — without touching provider keys in your app |

---

## How it works

```
Gmail poll
  │
  ├─[classify]  claude-haiku-3-5  →  { category, severity, keywords }
  ├─[route]     keyword match against routing.yaml
  ├─[research]  claude-haiku-3-5 + github_search_issues (tool loop)
  ├─[tiebreak]  claude-sonnet-4-5  (only when multiple repos tie)
  ├─[draft]     claude-sonnet-4-5 / claude-opus-4 for security/legal
  ├─[notify]    slack_send_message → #channel
  └─[dashboard] localhost:3000 — Approve → file issue + send reply
                               Reject  → discard
```

Each stage runs a different model. You change the mapping in `routing.yaml` — no code edits needed.

---

## Prerequisites

- Node.js ≥ 24 (uses built-in `node:sqlite`)
- A [Scalekit](https://app.scalekit.com) project with Gmail, GitHub, and Slack connected apps enabled
- A LiteLLM API key from the Scalekit dashboard (`llm.scalekit.cloud`)

---

## Quick start

### 1. Create a Scalekit project

1. Sign up at [app.scalekit.com](https://app.scalekit.com) and create a project.
2. Under **AgentKit → Connections**, create a connection for each service: Gmail, GitHub, and Slack.
3. Copy the exact **Connection name** shown for each connection — it appears next to the connection type and may differ from the provider slug (e.g. you might see `gmail-prod` instead of `gmail`).
4. Copy your **Environment URL**, **Client ID**, and **Client Secret** from the project settings.

### 2. Get a LiteLLM API key

From the Scalekit dashboard, navigate to **LLM Gateway** and generate a virtual API key. This key lets your app call `llm.scalekit.cloud` — Scalekit manages the upstream provider credentials.

Verify the gateway is reachable:

```bash
curl -H "Authorization: Bearer $LITELLM_API_KEY" \
     https://llm.scalekit.cloud/v1/models
```

You should see Claude model IDs in the response. Update `routing.yaml` → `models:` if the names differ.

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

```
SCALEKIT_ENV_URL=https://your-project.scalekit.cloud
SCALEKIT_CLIENT_ID=skc_...
SCALEKIT_CLIENT_SECRET=sks_...
SCALEKIT_USER_IDENTIFIER=you@example.com   # any stable identifier

# Exact Connection names from Scalekit dashboard → AgentKit → Connections
GMAIL_CONNECTION_NAME=gmail      # copy from dashboard
GITHUB_CONNECTION_NAME=github    # copy from dashboard
SLACK_CONNECTION_NAME=slack      # copy from dashboard

LITELLM_BASE_URL=https://llm.scalekit.cloud
LITELLM_API_KEY=sk-...
```

### 4. Install and run

```bash
npm install
npm run dev
```

**First run:** the agent prints an authorization link for each connector in sequence. Open each link in your browser, grant access, and press Enter in the terminal.

```
Checking connector authorization…
Authorize gmail here:
  https://connect.scalekit.com/...
Press Enter after you have authorized gmail...
connector gmail active
Authorize github here:
  https://connect.scalekit.com/...
...
All connectors active.
poller started  {"intervalMs":5000}
dashboard listening on http://localhost:3000
```

### 5. Send a test email

Send an email to the Gmail account you just connected. Include a stack trace or the word "node" in the body. Wait one poll interval (~5 s).

### 6. Open the dashboard

`http://localhost:3000`

A pending proposal appears showing:
- Classification (category, severity) from claude-haiku-3-5
- Routed GitHub repository
- Related issues found by the research agent
- Draft issue body and email reply

Click **Approve & file** to:
1. Create the GitHub issue in the routed repo
2. Send an email reply on the original thread
3. Update the Slack notification with the issue link

Click **Reject** to discard without any side effects.

---

## Configuration reference

### `routing.yaml`

```yaml
models:
  classify: claude-haiku-3-5        # cheap, fast classification
  research: claude-haiku-3-5        # tool-calling loop for issue search
  tiebreak: claude-sonnet-4-5       # used when multiple repos tie
  draft_default: claude-sonnet-4-5  # issue + reply drafting
  draft_sensitive: claude-opus-4    # security / legal category threads

repos:
  - name: owner/repo
    keywords: [keyword1, keyword2]  # matched against subject + body + AI keywords
    labels: [label1, label2]        # applied to the created GitHub issue
    slack_channel: "#channel-name"

default:
  name: owner/fallback-repo         # used when no keyword matches
  labels: [needs-triage]
  slack_channel: "#triage"
```

### `.env` variables

| Variable | Description |
|---|---|
| `SCALEKIT_ENV_URL` | Your Scalekit environment URL |
| `SCALEKIT_CLIENT_ID` | OAuth client ID |
| `SCALEKIT_CLIENT_SECRET` | OAuth client secret |
| `SCALEKIT_USER_IDENTIFIER` | Stable identifier for the connected user (any string) |
| `GMAIL_CONNECTION_NAME` | Exact Connection name from **AgentKit → Connections** (default: `gmail`) |
| `GITHUB_CONNECTION_NAME` | Exact Connection name from **AgentKit → Connections** (default: `github`) |
| `SLACK_CONNECTION_NAME` | Exact Connection name from **AgentKit → Connections** (default: `slack`) |
| `LITELLM_BASE_URL` | LiteLLM gateway URL (default: `https://llm.scalekit.cloud`) |
| `LITELLM_API_KEY` | Virtual API key from the Scalekit dashboard |
| `POLL_INTERVAL_MS` | How often to poll Gmail (default: `5000`) |
| `PORT` | Dashboard port (default: `3000`) |
| `DATA_DIR` | SQLite database directory (default: `./data`) |

---

## Project layout

```
src/
  index.ts           Entry point — auth setup, poller, web server
  config.ts          Zod-validated env + routing.yaml loader
  tools/
    auth.ts          3-connector setup flow (magic-link per connector)
    agentkit.ts      callTool() wrapper around client.actions.executeTool
  lib/
    litellm.ts       OpenAI-compatible client → llm.scalekit.cloud
    log.ts           Pino logger
  store/
    schema.sql       SQLite schema: cursor, proposals, actions
    db.ts            node:sqlite (DatabaseSync) access functions
  pipeline/
    ingest.ts        Gmail polling with SQLite cursor
    classify.ts      LiteLLM classification stage
    route.ts         Deterministic keyword routing
    research.ts      Mini-agent: tool-calling loop for GitHub search
    tiebreak.ts      LiteLLM tiebreak when multiple repos score equally
    draft.ts         Issue + email reply drafting
    notify.ts        Slack one-way notification
    act.ts           GitHub issue create + Gmail reply + Slack update
  web/
    server.ts        Express API: GET /api/proposals, POST .../approve, .../reject
    views/           Single-page dashboard (vanilla JS, no build step)
```

---

## Running tests

```bash
npm test
```

Tests use vitest with fixture threads (`fixtures/threads/`). AgentKit and LiteLLM are mocked — no network calls.

```bash
npm run typecheck   # tsc --noEmit
```

---

## Extending this demo

See [COOKBOOK.md](./COOKBOOK.md) for step-by-step guides on:
- Adding a new connector (e.g. Notion, Linear)
- Adding a new routing repo
- Swapping a stage's model
- Adding a new pipeline stage

---

## How AgentKit handles OAuth

When you call `client.actions.executeTool(...)`, Scalekit handles token refresh, scopes, and connector-specific API differences transparently. Your code never sees raw access tokens. The `identifier` field ties all three connectors to the same logical user — one person's Gmail, GitHub, and Slack can be accessed with a single identifier string, scoped entirely to your Scalekit project.

## How LiteLLM routing works

`routing.yaml` maps stage names to model IDs. `src/lib/litellm.ts` reads this at startup and passes the right model name to each `chat.completions.create` call. To swap a model for a stage, edit one line in `routing.yaml` — no code change needed.

The `draft_sensitive` model (`claude-opus-4` by default) is selected automatically when the classification stage reports `category: security` or `category: legal`, ensuring your most capable model handles high-stakes copy.
