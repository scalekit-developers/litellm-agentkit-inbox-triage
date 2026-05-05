import { ScalekitClient } from '@scalekit-sdk/node';
import { callTool } from '../tools/agentkit.js';
import type { ProposalRow } from '../store/db.js';
import type { RouteResult } from './route.js';
import type { DraftResult } from './draft.js';
import type { ConnectorNames } from '../config.js';
import { log } from '../lib/log.js';

export interface ActResult {
  githubUrl: string | undefined;
  emailSent: boolean;
  slackUpdated: boolean;
}

export interface ActOptions {
  createIssue: boolean;
  sendReply: boolean;
}

export async function actOnProposal(
  client: ScalekitClient,
  proposal: ProposalRow,
  identifier: string,
  connectors: ConnectorNames,
  options: ActOptions = { createIssue: true, sendReply: true },
): Promise<ActResult> {
  const route: RouteResult = JSON.parse(proposal.route);
  const drafts: DraftResult = JSON.parse(proposal.drafts);
  const [owner, repo] = route.winner.name.split('/');

  let githubUrl: string | undefined;
  let issueNumber: number | undefined;

  // 1. Create GitHub issue (optional)
  if (options.createIssue) {
    log.info({ repo: route.winner.name, title: drafts.issueTitle }, 'act: creating github issue');
    const issue = await callTool(client, connectors.github, 'github_issue_create', {
      owner,
      repo,
      title: drafts.issueTitle,
      body: drafts.issueBody,
    }, identifier) as { html_url: string; number: number };
    githubUrl = issue.html_url;
    issueNumber = issue.number;
    log.info({ url: githubUrl }, 'act: issue created');
  }

  // Email reply: the Scalekit Gmail connector is currently read-only (no send tool).
  // The draft is stored in the proposal for reference but cannot be sent automatically.
  const emailSent = false;
  if (options.sendReply) {
    log.info({ threadId: proposal.thread_id }, 'act: email reply skipped — Gmail connector is read-only');
  }

  // 3. Update Slack message if we have a ts
  let slackUpdated = false;
  if (proposal.slack_ts) {
    try {
      const channel = route.winner.slack_channel;
      const slackText = githubUrl
        ? `✅ Filed as <${githubUrl}|#${issueNumber}> in ${route.winner.name}`
        : `✅ Approved (email reply only) for ${route.winner.name}`;
      await callTool(client, connectors.slack, 'slack_update_message', {
        channel,
        ts: proposal.slack_ts,
        text: slackText,
      }, identifier);
      slackUpdated = true;
      log.info({ slackTs: proposal.slack_ts }, 'act: slack message updated');
    } catch (err) {
      log.warn({ err }, 'act: slack update failed (non-fatal)');
    }
  }

  return { githubUrl, emailSent, slackUpdated };
}
