import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ScalekitClient } from '@scalekit-sdk/node';
import type { DatabaseSync } from 'node:sqlite';
import type { ConnectorNames } from '../config.js';
import {
  getPendingProposals,
  getProposal,
  updateProposalStatus,
  insertAction,
} from '../store/db.js';
import { actOnProposal } from '../pipeline/act.js';
import { log } from '../lib/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(
  db: DatabaseSync,
  client: ScalekitClient,
  identifier: string,
  port: number,
  connectors: ConnectorNames,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(resolve(__dirname, 'views')));

  app.get('/', (_req, res) => {
    res.sendFile(resolve(__dirname, 'views', 'index.html'));
  });

  app.get('/api/proposals', (_req, res) => {
    const rows = getPendingProposals(db).map(row => ({
      ...row,
      classification: JSON.parse(row.classification),
      route: JSON.parse(row.route),
      research: JSON.parse(row.research),
      drafts: JSON.parse(row.drafts),
    }));
    res.json(rows);
  });

  app.post('/api/proposals/:id/approve', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const proposal = getProposal(db, id);
    if (!proposal) return res.status(404).json({ error: 'proposal not found' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `proposal is ${proposal.status}` });

    try {
      const result = await actOnProposal(client, proposal, identifier, connectors);
      updateProposalStatus(db, id, 'approved');
      insertAction(db, {
        proposalId: id,
        githubUrl: result.githubUrl,
        emailSent: result.emailSent,
        slackUpdated: result.slackUpdated,
      });
      log.info({ id, githubUrl: result.githubUrl }, 'proposal approved');
      return res.json({ githubUrl: result.githubUrl });
    } catch (err) {
      log.error({ err, id }, 'approve: action failed');
      return res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/proposals/:id/reject', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const proposal = getProposal(db, id);
    if (!proposal) return res.status(404).json({ error: 'proposal not found' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `proposal is ${proposal.status}` });

    updateProposalStatus(db, id, 'rejected');
    log.info({ id }, 'proposal rejected');
    return res.json({ ok: true });
  });

  return app;
}

export function startServer(app: express.Express, port: number): void {
  app.listen(port, 'localhost', () => {
    log.info({ port }, 'dashboard listening on http://localhost:' + port);
  });
}
