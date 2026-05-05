import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

// ---------- env ----------

const EnvSchema = z.object({
  SCALEKIT_ENV_URL: z.string().url(),
  SCALEKIT_CLIENT_ID: z.string().min(1),
  SCALEKIT_CLIENT_SECRET: z.string().min(1),
  SCALEKIT_USER_IDENTIFIER: z.string().min(1),
  // Connection names must match the exact names in Scalekit dashboard → AgentKit → Connections
  GMAIL_CONNECTION_NAME: z.string().min(1).default('gmail'),
  GITHUB_CONNECTION_NAME: z.string().min(1).default('github'),
  SLACK_CONNECTION_NAME: z.string().min(1).default('slack'),
  LITELLM_BASE_URL: z.string().url().default('https://llm.scalekit.cloud'),
  LITELLM_API_KEY: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface ConnectorNames {
  gmail: string;
  github: string;
  slack: string;
}

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid env vars: ${missing}`);
  }
  return result.data;
}

// ---------- routing.yaml ----------

const RepoSchema = z.object({
  name: z.string(),
  keywords: z.array(z.string()),
  labels: z.array(z.string()),
  slack_channel: z.string(),
});

const ModelsSchema = z.object({
  classify: z.string(),
  research: z.string(),
  tiebreak: z.string(),
  draft_default: z.string(),
  draft_sensitive: z.string(),
});

const RoutingSchema = z.object({
  models: ModelsSchema,
  repos: z.array(RepoSchema),
  default: z.object({
    name: z.string(),
    keywords: z.array(z.string()).default([]),
    labels: z.array(z.string()),
    slack_channel: z.string(),
  }),
});

export type RoutingConfig = z.infer<typeof RoutingSchema>;
export type RepoConfig = z.infer<typeof RepoSchema>;

export function loadRouting(path = resolve(process.cwd(), 'routing.yaml')): RoutingConfig {
  const raw = readFileSync(path, 'utf-8');
  const parsed = yaml.load(raw);
  const result = RoutingSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid routing.yaml: ${result.error.message}`);
  }
  return result.data;
}
