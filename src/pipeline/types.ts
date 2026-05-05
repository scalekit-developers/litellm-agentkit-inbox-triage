export interface GmailThread {
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  body: string;
  internalDate: string; // ISO string
}
