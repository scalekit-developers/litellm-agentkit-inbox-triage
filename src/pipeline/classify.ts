import { complete, parseJson } from '../lib/litellm.js';
import type { GmailThread } from './types.js';
import type { RoutingConfig } from '../config.js';

export interface ClassifyResult {
  category: 'bug' | 'feature' | 'docs' | 'security' | 'legal' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  keywords: string[];
  hasRepro: boolean;
  summary: string;
}

const SYSTEM_PROMPT = `You are an inbox triage assistant for a developer tools company.

Given an inbound email thread, classify it and extract key metadata.

Respond with ONLY a JSON object (no markdown):
{
  "category": "bug" | "feature" | "docs" | "security" | "legal" | "other",
  "severity": "critical" | "high" | "medium" | "low",
  "keywords": ["array", "of", "technology", "keywords"],
  "hasRepro": true | false,
  "summary": "one-line description of the issue"
}

Rules:
- category "security": any mention of vulnerabilities, CVEs, auth bypass, data exposure
- category "legal": GDPR, licensing, compliance, legal requests
- severity "critical": production down, data loss, security vulnerability
- severity "high": blocking issue with no workaround
- hasRepro: true if the email contains a code snippet, stack trace, or steps to reproduce`;

export async function classifyThread(
  thread: GmailThread,
  routing: RoutingConfig,
  litellmConfig: { baseURL: string; apiKey: string },
): Promise<ClassifyResult> {
  const userContent = [
    `Subject: ${thread.subject}`,
    `From: ${thread.from}`,
    `Body:\n${(thread.body ?? '').slice(0, 2000)}`,
  ].join('\n\n');

  const result = await complete({
    stage: 'classify',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    jsonMode: true,
    routing,
    ...litellmConfig,
  });

  return parseJson<ClassifyResult>(result.content);
}
