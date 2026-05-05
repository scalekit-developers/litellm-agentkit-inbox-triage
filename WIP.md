# litellm-agentkit-inbox-triage — WIP

**Status:** Implementation complete · Pending GitHub push + submodule registration  
**Last updated:** 2026-05-05  
**GitHub repo:** TBD — will be created as `scalekit-developers/litellm-agentkit-inbox-triage`, then added as submodule at `ecosystem/litellm-agentkit-inbox-triage` in `feedback-syndicate`.

---

## What this is

An **educational TypeScript demo** showing how Scalekit AgentKit (delegated cross-tool access across Gmail, GitHub, and Slack) and LiteLLM (per-stage model routing) compose into a real agentic workflow.

**Use case — Inbox → GitHub-issue dispatcher:**  
A Gmail inbox of inbound bug/feature reports is triaged by an agent that:

1. Classifies each thread with LiteLLM (gemini-flash — cheap)
2. Searches for duplicate GitHub issues (mini-agent loop)
3. Routes to the right repo from a config file (+ LiteLLM tiebreaker when ambiguous)
4. Drafts a GitHub issue + email reply (gpt-4o or claude-3-7 depending on category)
5. Sends a one-way Slack notification to the area-owner channel
6. Waits for human approval in a local web dashboard
7. On approval: files the GitHub issue and sends the Gmail reply

---

## Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Stack | TypeScript first; Python sibling planned | TS matches existing ecosystem demos |
| Inbound | Live Gmail via AgentKit polling | Most realistic demo of AgentKit-as-source |
| Architecture | Hybrid (linear pipeline + mini-agent for GitHub research) | Linear = readable; mini-agent where tool iteration pays off |
| Repo routing | YAML keywords + LiteLLM tiebreaker | Config-first, model-as-tiebreaker is teachable pattern |
| Slack | One-way `slack_send_message` only | Avoids separate Slack App + interactivity URL |
| Approval surface | Local web dashboard at localhost:3000 | Zero external setup; surfaces full pipeline state visually |
| User Verification | Custom mode (`/user/verify` route, state-cookie CSRF) | Teaches production AgentKit pattern; "Scalekit users only" documented as dev shortcut |
| LiteLLM | Proxy mode (local Docker or hosted gateway) → Node calls OpenAI-compat HTTP | LiteLLM is Python-first; this is the canonical Node integration pattern |
| Persistence | SQLite (`better-sqlite3`, `./data/triage.db`) | Zero-deps, survives restart, easy reset (delete file) |
| Deployment | v1 local only | Render template deferred to v2 |

---

## Architecture

```
Gmail poll (gmail_search_messages since cursor)
   ▼
[CLASSIFY]  litellm @ gemini-flash
   out: { category, severity, keywords[], repro? }
   ▼
[ROUTE]     routing.yaml keyword match → candidates[]
   ▼
[RESEARCH]  mini-agent: litellm + [github_search_issues, github_get_issue]
   out: related[]
   ▼
[TIEBREAK]  if candidates > 1 → litellm @ gpt-4o
   out: { repo, labels[], reasoning }
   ▼
[DRAFT]     litellm @ gpt-4o (default) or claude-3-7 (security/legal)
   out: { issueTitle, issueBody, emailReplyBody }
   ▼
[NOTIFY]    slack_send_message → area channel ("Triage queued — see dashboard")
   ▼
[STORE]     SQLite proposal row → status=pending
   ▼
            ─── waits for dashboard Approve/Reject ───
   ▼
[ACT]       github_create_issue → gmail_send_email → slack update "✅ filed as #N"
```

**User Verification (connection bootstrap, one-time per connector):**

```
Dashboard "Connect Gmail" button
  → GET /connect/gmail
      scalekit.actions.getAuthorizationLink({ identifier, userVerifyUrl, state })
      Set-Cookie: triage_state=<state>; HttpOnly
      302 → magic link
  → Provider OAuth → Scalekit stores tokens
  → 302 → /user/verify?auth_request_id=...&state=...
      validate state vs cookie
      scalekit.actions.verifyConnectedAccountUser({ authRequestId, identifier })
      302 → dashboard (connector now ✅)
```

---

## File structure

```
ecosystem/litellm-agentkit-inbox-triage/
├── README.md
├── WIP.md                             ← this file
├── package.json                       # tsx, express, better-sqlite3, openai, @scalekit/sdk-node, zod, pino, vitest
├── tsconfig.json
├── .env.example
├── routing.yaml                       # repos × keywords × labels × slack_channel + stage→model map
├── litellm/config.yaml                # LiteLLM proxy model list
├── docker-compose.yml                 # spins up LiteLLM proxy
├── src/
│   ├── index.ts                       # boot: poller + web server
│   ├── config.ts                      # zod-validated env + routing.yaml
│   ├── pipeline/
│   │   ├── ingest.ts                  # gmail_search_messages + gmail_get_thread
│   │   ├── classify.ts                # LiteLLM structured output
│   │   ├── route.ts                   # keyword match → candidates
│   │   ├── research.ts                # mini-agent (github_search_issues, github_get_issue)
│   │   ├── tiebreak.ts                # LiteLLM picks repo when ambiguous
│   │   ├── draft.ts                   # LiteLLM drafts issue + reply
│   │   ├── notify.ts                  # slack_send_message
│   │   └── act.ts                     # github_create_issue + gmail_send_email + slack update
│   ├── tools/
│   │   └── agentkit.ts                # callTool(connector, tool, params, identifier)
│   ├── store/
│   │   ├── schema.sql                 # tables: cursor, proposals, actions
│   │   └── pending.ts                 # better-sqlite3 read/write
│   ├── web/
│   │   ├── server.ts                  # Express: /, /api/*, /connect/:connector, /user/verify
│   │   ├── connections.ts             # getAuthorizationLink, verifyConnectedAccountUser, state cookie
│   │   ├── views/index.html           # Connections panel + Pending list + Detail view
│   │   └── views/app.js               # vanilla fetch, no build step
│   └── lib/
│       ├── litellm.ts                 # complete({ stage, messages, schema?, tools? }) → OpenAI-compat
│       └── log.ts                     # pino
├── fixtures/threads/*.json            # seeded Gmail threads for vitest
├── scripts/seed-routing.ts            # generate starter routing.yaml from repo list
└── tests/pipeline.spec.ts             # vitest, mocked AgentKit + LiteLLM, fixture-driven
```

---

## Configuration

**.env.example**

```
SCALEKIT_ENVIRONMENT_URL=
SCALEKIT_CLIENT_ID=
SCALEKIT_CLIENT_SECRET=
SCALEKIT_USER_IDENTIFIER=          # the connected user's email/id
APP_BASE_URL=http://localhost:3000  # used to build user_verify_url
SESSION_SECRET=                    # signs state cookie for CSRF protection
USER_VERIFICATION_MODE=custom      # custom | scalekit-users-only
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=
POLL_INTERVAL_MS=5000
PORT=3000
DATA_DIR=./data
```

**routing.yaml (starter)**

```yaml
models:
  classify: gemini/gemini-1.5-flash
  tiebreak: openai/gpt-4o
  draft_default: openai/gpt-4o
  draft_sensitive: anthropic/claude-3-7-sonnet
  research: openai/gpt-4o-mini

repos:
  - name: scalekit-inc/scalekit-sdk-node
    keywords: [node, npm, typescript, javascript]
    labels: [sdk, area:node]
    slack_channel: "#node-sdk"
  - name: scalekit-inc/scalekit-sdk-python
    keywords: [python, pypi, pip]
    labels: [sdk, area:python]
    slack_channel: "#python-sdk"
  - name: scalekit-inc/developer-docs
    keywords: [docs, documentation, tutorial, guide, broken link]
    labels: [docs]
    slack_channel: "#devrel"

default:
  name: scalekit-inc/triage
  labels: [needs-triage]
  slack_channel: "#triage"
```

---

## Implementation sequence

- [ ] **1. Scaffold** — `package.json`, `tsconfig.json`, `.env.example`, `routing.yaml`, `litellm/config.yaml`, `docker-compose.yml`
- [ ] **2. Config loader** — `src/config.ts` with zod; validates env + routing.yaml; exports typed config
- [ ] **3. AgentKit wrapper** — `src/tools/agentkit.ts`; mirror pattern from `community-repos/scalekit-developers/agent-auth-examples/javascript/frameworks/quickstart/`
- [ ] **4. LiteLLM wrapper** — `src/lib/litellm.ts`; uses openai SDK pointed at `LITELLM_BASE_URL`; stage→model from config
- [ ] **5. SQLite store** — `src/store/schema.sql` + `src/store/pending.ts`
- [ ] **6. Pipeline stages** (build bottom-up + vitest per stage):
  - [ ] `act.ts`
  - [ ] `notify.ts`
  - [ ] `draft.ts`
  - [ ] `tiebreak.ts`
  - [ ] `research.ts` (mini-agent)
  - [ ] `route.ts`
  - [ ] `classify.ts`
  - [ ] `ingest.ts`
- [ ] **7. Web dashboard + connections** — Express server, Connections panel, Approve/Reject, `/connect/:connector`, `/user/verify`
- [ ] **8. Wire-up** — `src/index.ts` boots poller + server
- [ ] **9. End-to-end test** — connect Gmail/GitHub/Slack via dashboard, send test email, approve, verify GitHub issue + email reply
- [ ] **10. README** — setup walkthrough (Scalekit dashboard → Connected Apps → User Verification → `.env` → LiteLLM proxy → `npm run dev` → connect connectors → demo)
- [ ] **11. Create GitHub repo + add as submodule** — per `AGENTS.md` § "Submodule PR Workflow"

---

## Key references

| Resource | Path |
|---|---|
| AgentKit quickstart JS example | `community-repos/scalekit-developers/agent-auth-examples/javascript/frameworks/quickstart/` |
| AgentKit connector tool names (canonical) | `docs/developer-docs/src/data/agent-connectors/{gmail,github,slack}.ts` |
| User Verification docs | `docs/developer-docs/src/content/docs/agentkit/user-verification.mdx` |
| Sibling ecosystem project (README/layout style) | `ecosystem/render-ai-agent-deploykit/` |
| Submodule + PR workflow rules | `AGENTS.md` § "Submodule PR Workflow" |

---

## Out of scope for v1

- Render deploy template (v2)
- Slack interactive-button approval (requires separate Slack App)
- Multi-user / multi-tenant watching
- Gmail Pub/Sub push (v1 polls)
- Dashboard auth wall (v1 localhost-only)
- Python sibling repo (separate plan)
