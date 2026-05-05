import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ClassifyResult } from '../pipeline/classify.js';
import type { RouteResult } from '../pipeline/route.js';
import type { ResearchResult } from '../pipeline/research.js';
import type { DraftResult } from '../pipeline/draft.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, 'schema.sql');

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface ProposalRow {
  id: number;
  thread_id: string;
  subject: string;
  from_address: string;
  classification: string;
  route: string;
  research: string;
  drafts: string;
  status: ProposalStatus;
  slack_ts: string | null;
  created_at: string;
}

export interface ActionRow {
  id: number;
  proposal_id: number;
  github_url: string | null;
  email_sent: number;
  slack_updated: number;
  acted_at: string;
}

export interface InsertProposalOpts {
  threadId: string;
  subject: string;
  fromAddress: string;
  classification: ClassifyResult;
  route: RouteResult;
  research: ResearchResult;
  drafts: DraftResult;
  slackTs?: string;
}

export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'triage.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));

  // Seed cursor on first run
  const row = db.prepare('SELECT id FROM cursor WHERE id = 1').get();
  if (!row) {
    db.prepare('INSERT INTO cursor (id, last_seen_at) VALUES (1, ?)').run(new Date().toISOString());
  }

  return db;
}

export function getCursor(db: DatabaseSync): string {
  const row = db.prepare('SELECT last_seen_at FROM cursor WHERE id = 1').get() as { last_seen_at: string };
  return row.last_seen_at;
}

export function updateCursor(db: DatabaseSync, ts: string): void {
  db.prepare('UPDATE cursor SET last_seen_at = ? WHERE id = 1').run(ts);
}

export function insertProposal(db: DatabaseSync, opts: InsertProposalOpts): number {
  const result = db.prepare(`
    INSERT OR IGNORE INTO proposals
      (thread_id, subject, from_address, classification, route, research, drafts, status, slack_ts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    opts.threadId,
    opts.subject,
    opts.fromAddress,
    JSON.stringify(opts.classification),
    JSON.stringify(opts.route),
    JSON.stringify(opts.research),
    JSON.stringify(opts.drafts),
    opts.slackTs ?? null,
    new Date().toISOString(),
  );
  return result.lastInsertRowid as number;
}

export function getPendingProposals(db: DatabaseSync): ProposalRow[] {
  return db.prepare("SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at DESC").all() as unknown as ProposalRow[];
}

export function getProposal(db: DatabaseSync, id: number): ProposalRow | undefined {
  return db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as unknown as ProposalRow | undefined;
}

export function updateProposalStatus(db: DatabaseSync, id: number, status: ProposalStatus): void {
  db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, id);
}

export function updateProposalSlackTs(db: DatabaseSync, id: number, slackTs: string): void {
  db.prepare('UPDATE proposals SET slack_ts = ? WHERE id = ?').run(slackTs, id);
}

export function insertAction(db: DatabaseSync, opts: {
  proposalId: number;
  githubUrl?: string;
  emailSent: boolean;
  slackUpdated: boolean;
}): void {
  db.prepare(`
    INSERT INTO actions (proposal_id, github_url, email_sent, slack_updated, acted_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    opts.proposalId,
    opts.githubUrl ?? null,
    opts.emailSent ? 1 : 0,
    opts.slackUpdated ? 1 : 0,
    new Date().toISOString(),
  );
}
