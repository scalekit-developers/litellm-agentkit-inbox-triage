import { ScalekitClient } from '@scalekit-sdk/node';
import { callTool } from '../tools/agentkit.js';
import { getCursor, updateCursor } from '../store/db.js';
import type { GmailThread } from './types.js';
import type { DatabaseSync } from 'node:sqlite';
import { log } from '../lib/log.js';

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractBody(msg: GmailMessage): string {
  const payload = msg.payload;
  if (!payload) return msg.snippet;

  // Prefer text/plain part
  const textPart = payload.parts?.find(p => p.mimeType === 'text/plain');
  if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return msg.snippet;
}

function getHeader(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function ingestThreads(
  client: ScalekitClient,
  db: DatabaseSync,
  identifier: string,
  gmailConnectionName: string,
): Promise<GmailThread[]> {
  const cursor = getCursor(db);

  const fetchResult = await callTool(client, gmailConnectionName, 'gmail_fetch_mails', {
    query: `is:unread after:${Math.floor(new Date(cursor).getTime() / 1000)}`,
    max_results: 20,
  }, identifier) as { messages?: Array<{ id: string; threadId: string }> };

  const messageRefs = fetchResult.messages ?? [];
  if (messageRefs.length === 0) return [];

  log.info({ count: messageRefs.length }, 'gmail: found unread messages');

  const threads: GmailThread[] = [];
  let latestDate = cursor;

  for (const ref of messageRefs) {
    const msg = await callTool(client, gmailConnectionName, 'gmail_get_message_by_id', {
      message_id: ref.id,
      format: 'full',
    }, identifier) as GmailMessage;

    const date = new Date(parseInt(msg.internalDate, 10)).toISOString();
    if (date > latestDate) latestDate = date;

    threads.push({
      threadId: msg.threadId,
      subject: getHeader(msg, 'Subject') || '(no subject)',
      from: getHeader(msg, 'From'),
      snippet: msg.snippet,
      body: extractBody(msg),
      internalDate: date,
    });
  }

  // Advance cursor past the newest message we saw
  if (latestDate > cursor) {
    updateCursor(db, latestDate);
  }

  return threads;
}
