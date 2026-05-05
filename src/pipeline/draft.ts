import { complete, parseJson } from '../lib/litellm.js';
import type { GmailThread } from './types.js';
import type { ClassifyResult } from './classify.js';
import type { RouteResult } from './route.js';
import type { ResearchResult } from './research.js';
import type { RoutingConfig } from '../config.js';

export interface DraftResult {
  issueTitle: string;
  issueBody: string;
  emailReplyBody: string;
}

const SENSITIVE_CATEGORIES = new Set(['security', 'legal']);

const SYSTEM_PROMPT = `You are a developer relations assistant. Draft a GitHub issue and email reply for a reported problem.

Respond with ONLY a JSON object (no markdown):
{
  "issueTitle": "concise title under 72 chars",
  "issueBody": "markdown issue body with context, steps to reproduce if available, and reporter info redacted",
  "emailReplyBody": "friendly, professional reply acknowledging receipt and providing next steps"
}

For the issue body:
- Use markdown headings: ## Description, ## Steps to Reproduce (if known), ## Related Issues
- Link any related issues as "Related: #N"
- Do not include PII (email addresses, names)

For the email reply:
- Acknowledge the report
- Tell them an issue has been filed (or will be once reviewed)
- Provide an expected response timeline (2–3 business days for non-critical)
- Keep it under 150 words`;

export async function draftProposal(
  thread: GmailThread,
  classification: ClassifyResult,
  route: RouteResult,
  research: ResearchResult,
  routing: RoutingConfig,
  litellmConfig: { baseURL: string; apiKey: string },
): Promise<DraftResult> {
  const stage = SENSITIVE_CATEGORIES.has(classification.category)
    ? ('draft_sensitive' as const)
    : ('draft_default' as const);

  const relatedIssuesSummary = research.related.length > 0
    ? research.related.map(i => `- #${i.number}: ${i.title} (${i.state}) — ${i.url}`).join('\n')
    : 'None found';

  const userContent = [
    `Subject: ${thread.subject}`,
    `Category: ${classification.category} | Severity: ${classification.severity}`,
    `Repository: ${route.winner.name}`,
    `Labels: ${route.winner.labels.join(', ')}`,
    `\nEmail body:\n${thread.body.slice(0, 2000)}`,
    `\nRelated issues:\n${relatedIssuesSummary}`,
  ].join('\n');

  const result = await complete({
    stage,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    jsonMode: true,
    routing,
    ...litellmConfig,
  });

  return parseJson<DraftResult>(result.content);
}
