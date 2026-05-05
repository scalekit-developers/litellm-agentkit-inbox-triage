import { ScalekitClient } from '@scalekit-sdk/node';
import { callTool } from '../tools/agentkit.js';
import type { DraftResult } from './draft.js';
import type { RouteResult } from './route.js';
import type { ClassifyResult } from './classify.js';
import { log } from '../lib/log.js';

export async function notifySlack(
  client: ScalekitClient,
  proposalId: number,
  classification: ClassifyResult,
  route: RouteResult,
  drafts: DraftResult,
  identifier: string,
): Promise<string | undefined> {
  const channel = route.winner.slack_channel;
  const severityEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[classification.severity] ?? '⚪';

  const text = [
    `${severityEmoji} *Triage queued* — proposal #${proposalId}`,
    `*Repo:* ${route.winner.name}`,
    `*Issue:* ${drafts.issueTitle}`,
    `*Severity:* ${classification.severity} | *Category:* ${classification.category}`,
    `Review and approve at <http://localhost:${process.env.PORT ?? 3000}|the dashboard>`,
  ].join('\n');

  try {
    const result = await callTool(client, 'slack', 'slack_send_message', {
      channel,
      text,
    }, identifier) as { ts?: string };

    log.info({ channel, proposalId }, 'slack: notified');
    return result.ts;
  } catch (err) {
    // Slack notify is best-effort — don't fail the whole pipeline
    log.warn({ err, channel }, 'slack: notify failed (non-fatal)');
    return undefined;
  }
}
