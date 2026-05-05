import 'dotenv/config';
import { loadEnv, loadRouting } from './config.js';
import { createScalekitClient, setupConnectors } from './tools/auth.js';
import { openDb } from './store/db.js';
import { ingestThreads } from './pipeline/ingest.js';
import { classifyThread } from './pipeline/classify.js';
import { routeThread } from './pipeline/route.js';
import { researchRelatedIssues } from './pipeline/research.js';
import { tiebreakRepo } from './pipeline/tiebreak.js';
import { draftProposal } from './pipeline/draft.js';
import { notifySlack } from './pipeline/notify.js';
import { insertProposal, updateProposalSlackTs } from './store/db.js';
import { createServer, startServer } from './web/server.js';
import { log } from './lib/log.js';

async function main() {
  const env = loadEnv();
  const routing = loadRouting();
  const litellmConfig = { baseURL: env.LITELLM_BASE_URL, apiKey: env.LITELLM_API_KEY };
  const connectors = {
    gmail: env.GMAIL_CONNECTION_NAME,
    github: env.GITHUB_CONNECTION_NAME,
    slack: env.SLACK_CONNECTION_NAME,
  };

  const client = createScalekitClient(env);
  await setupConnectors(client, env.SCALEKIT_USER_IDENTIFIER, connectors);

  const db = openDb(env.DATA_DIR);

  // Start approval dashboard
  const app = createServer(db, client, env.SCALEKIT_USER_IDENTIFIER, env.PORT, connectors);
  startServer(app, env.PORT);

  log.info({ intervalMs: env.POLL_INTERVAL_MS }, 'poller started');

  async function poll() {
    let threads;
    try {
      threads = await ingestThreads(client, db, env.SCALEKIT_USER_IDENTIFIER, connectors.gmail);
    } catch (err) {
      log.error({ err }, 'ingest failed');
      return;
    }

    for (const thread of threads) {
      log.info({ threadId: thread.threadId, subject: thread.subject }, 'processing thread');

      try {
        // Classify
        const classification = await classifyThread(thread, routing, litellmConfig);
        log.debug({ classification }, 'classified');

        // Route
        let route = routeThread(thread, classification, routing);

        // Tiebreak if needed
        if (route.tied && route.candidates.length > 1) {
          log.debug('tie detected, running tiebreak');
          route = await tiebreakRepo(route.candidates, classification, routing, litellmConfig);
        }

        // Research
        const research = await researchRelatedIssues(
          client, classification, route.winner, routing, litellmConfig, env.SCALEKIT_USER_IDENTIFIER, connectors.github,
        );

        // Draft
        const drafts = await draftProposal(thread, classification, route, research, routing, litellmConfig);

        // Store proposal first so we have an ID for Slack notification
        const proposalId = insertProposal(db, {
          threadId: thread.threadId,
          subject: thread.subject,
          fromAddress: thread.from,
          classification,
          route,
          research,
          drafts,
        });

        // Notify Slack
        const slackTs = await notifySlack(
          client, proposalId, classification, route, drafts, env.SCALEKIT_USER_IDENTIFIER, connectors.slack,
        );
        if (slackTs) {
          updateProposalSlackTs(db, proposalId, slackTs);
        }

        log.info({ proposalId, repo: route.winner.name }, 'proposal queued');
      } catch (err) {
        log.error({ err, threadId: thread.threadId }, 'pipeline error — skipping thread');
      }
    }
  }

  // Run once immediately, then on interval
  await poll();
  setInterval(poll, env.POLL_INTERVAL_MS);
}

main().catch(err => {
  log.error({ err }, 'fatal error');
  process.exit(1);
});
