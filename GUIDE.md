# Cookbook — Extending the Inbox Triage Agent

This guide covers the four most common ways to customize this demo for your own workflow.

---

## Recipe 1: Add a new connector (e.g. Notion or Linear)

This demo uses Gmail, GitHub, and Slack. Scalekit AgentKit supports additional connectors — adding one involves three steps.

### Step 1: Enable the connector in Scalekit

In the Scalekit dashboard → **Connected Apps**, enable the new connector (e.g. Notion). The connector slug (e.g. `notion`) is what you'll pass to `callTool`.

### Step 2: Register it in the auth setup

`src/tools/auth.ts` iterates over a `CONNECTORS` array. Add your connector:

```typescript
const CONNECTORS = ['gmail', 'github', 'slack', 'notion'] as const;
```

On next startup, the agent will print a magic link for Notion and wait for authorization.

### Step 3: Call connector tools in a pipeline stage

Look up the available tool names for your connector in the Scalekit docs or by inspecting the connector catalog. Then call them via `callTool`:

```typescript
import { callTool } from '../tools/agentkit.js';

// Example: create a Notion page
const page = await callTool(client, 'notion', 'notion_create_page', {
  parent: { database_id: 'your-db-id' },
  properties: { title: [{ text: { content: issueTitle } }] },
}, identifier);
```

Add a call to the new connector in `src/pipeline/act.ts` alongside the GitHub and Gmail calls.

---

## Recipe 2: Add a new routing repository

Open `routing.yaml` and add an entry under `repos:`:

```yaml
repos:
  # ... existing entries ...
  - name: your-org/your-repo
    keywords: [go, golang, grpc]   # case-insensitive substrings
    labels: [sdk, area:go]
    slack_channel: "#go-sdk"
```

No code changes needed. On the next poll cycle, threads containing "go" or "golang" in their subject, body, or AI-extracted keywords will route to `your-org/your-repo`.

**Tip:** Keywords are scored by count — a thread mentioning "golang" three times scores higher than one mentioning it once. If two repos tie, the `tiebreak` model in `routing.yaml` decides.

---

## Recipe 3: Swap a stage's model

Every stage reads its model name from `routing.yaml`:

```yaml
models:
  classify: claude-haiku-3-5        # ← change this line
  research: claude-haiku-3-5
  tiebreak: claude-sonnet-4-5
  draft_default: claude-sonnet-4-5
  draft_sensitive: claude-opus-4
```

To use a different model for drafting, change `draft_default`. To verify which model IDs your gateway exposes, call the OpenAI-compatible models endpoint (same host as `LITELLM_BASE_URL` in `.env`):

```bash
curl -H "Authorization: Bearer $LITELLM_API_KEY" \
     "$LITELLM_BASE_URL/v1/models" | jq '.data[].id'
```

Use any returned ID verbatim as a value in `routing.yaml`.

**When to use a smaller model:** Classification and research are high-volume, low-stakes — `claude-haiku-3-5` is fast and cheap. Draft stages are low-volume and user-visible — `claude-sonnet-4-5` or higher is worth the cost.

---

## Recipe 4: Add a new pipeline stage

The pipeline is a linear sequence of async functions in `src/pipeline/`. Each stage takes typed inputs and returns a typed result. Here's how to add a **priority scoring** stage between `classify` and `route`.

### Step 1: Create the stage file

`src/pipeline/prioritize.ts`:

```typescript
import { complete, parseJson } from '../lib/litellm.js';
import type { ClassifyResult } from './classify.js';
import type { GmailThread } from './types.js';
import type { RoutingConfig } from '../config.js';

export interface PriorityResult {
  score: number;          // 1–10
  shouldSkip: boolean;    // true = obvious noise, skip remaining pipeline
  reason: string;
}

export async function prioritizeThread(
  thread: GmailThread,
  classification: ClassifyResult,
  routing: RoutingConfig,
  litellmConfig: { baseURL: string; apiKey: string },
): Promise<PriorityResult> {
  const result = await complete({
    stage: 'classify',   // reuse the classify model slot, or add a new 'priority' entry to routing.yaml
    messages: [
      {
        role: 'system',
        content: 'Score the priority of this issue 1-10 and decide if it should be skipped. Respond with ONLY JSON: {"score": N, "shouldSkip": bool, "reason": "one line"}',
      },
      {
        role: 'user',
        content: `Category: ${classification.category}\nSeverity: ${classification.severity}\nSummary: ${classification.summary}`,
      },
    ],
    jsonMode: true,
    routing,
    ...litellmConfig,
  });

  return parseJson<PriorityResult>(result.content);
}
```

### Step 2: Wire it into `src/index.ts`

```typescript
import { prioritizeThread } from './pipeline/prioritize.js';

// Inside the poll loop, after classifyThread:
const priority = await prioritizeThread(thread, classification, routing, litellmConfig);
if (priority.shouldSkip) {
  log.info({ threadId: thread.threadId, reason: priority.reason }, 'skipping low-priority thread');
  continue;
}
```

### Step 3: Store the result if you need it in the dashboard

Add a `priority` column to the `proposals` table in `src/store/schema.sql`, update `insertProposal` in `db.ts` to accept and store it, and render it in the dashboard HTML.

---

## Stage model map reference

| Stage key in `routing.yaml` | Pipeline file | When it runs |
|---|---|---|
| `classify` | `classify.ts` | Every thread |
| `research` | `research.ts` | Every thread (tool-calling loop) |
| `tiebreak` | `tiebreak.ts` | Only when ≥2 repos tie |
| `draft_default` | `draft.ts` | Non-security, non-legal threads |
| `draft_sensitive` | `draft.ts` | `category: security` or `category: legal` |

To add a new stage key, add it to the `ModelsSchema` in `src/config.ts` and to the `models:` block in `routing.yaml`:

```typescript
// src/config.ts
const ModelsSchema = z.object({
  classify: z.string(),
  research: z.string(),
  tiebreak: z.string(),
  draft_default: z.string(),
  draft_sensitive: z.string(),
  priority: z.string(),   // ← new
});
```

```yaml
# routing.yaml
models:
  priority: claude-haiku-3-5   # ← new
```

Then pass `stage: 'priority'` to `complete()` in your new stage file.
