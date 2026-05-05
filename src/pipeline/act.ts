import { ScalekitClient } from '@scalekit-sdk/node';
import { callTool } from '../tools/agentkit.js';
import type { ProposalRow } from '../store/db.js';
import type { RouteResult } from './route.js';
import type { DraftResult } from './draft.js';
import type { ConnectorNames } from '../config.js';
import { log } from '../lib/log.js';

export interface ActResult {
  githubUrl: string;
  emailSent: boolean;
  slackUpdated: boolean;
}

export async function actOnProposal(
  client: ScalekitClient,
  proposal: ProposalRow,
  identifier: string,
  connectors: ConnectorNames,
): Promise<ActResult> {
  const route: RouteResult = JSON.parse(proposal.route);
  const drafts: DraftResult = JSON.parse(proposal.drafts);
  const [owner, repo] = route.winner.name.split('/');

  // 1. Create GitHub issue
  log.info({ repo: route.winner.name, title: drafts.issueTitle }, 'act: creating github issue');
  const issue = await callTool(client, connectors.github, 'github_issue_create', {
    owner,
    repo,
    title: drafts.issueTitle,
    body: drafts.issueBody,
    labels: route.winner.labels,
  }, identifier) as { html_url: string; number: number };

  const githubUrl = issue.html_url;
  log.info({ url: githubUrl }, 'act: issue created');

  // 2. Send Gmail reply on original thread
  const replyBody = `${drafts.emailReplyBody}\n\n---\nTracking issue: ${githubUrl}`;
  let emailSent = false;
  try {
    await callTool(client, connectors.gmail, 'gmail_send_email', {
      to: proposal.from_address,
      subject: `Re: ${proposal.subject}`,
      body: replyBody,
      thread_id: proposal.thread_id,
    }, identifier);
    emailSent = true;
    log.info({ threadId: proposal.thread_id }, 'act: email reply sent');
  } catch (err) {
    log.warn({ err }, 'act: email reply failed (non-fatal)');
  }

  // 3. Update Slack message if we have a ts
  let slackUpdated = false;
  if (proposal.slack_ts) {
    try {
      const channel = route.winner.slack_channel;
      await callTool(client, connectors.slack, 'slack_update_message', {
        channel,
        ts: proposal.slack_ts,
        text: `✅ Filed as <${githubUrl}|#${issue.number}> in ${route.winner.name}`,
      }, identifier);
      slackUpdated = true;
      log.info({ slackTs: proposal.slack_ts }, 'act: slack message updated');
    } catch (err) {
      log.warn({ err }, 'act: slack update failed (non-fatal)');
    }
  }

  return { githubUrl, emailSent, slackUpdated };
}
