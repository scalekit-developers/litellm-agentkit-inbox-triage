import OpenAI from 'openai';
import type { RoutingConfig } from '../config.js';

export type Stage = keyof RoutingConfig['models'];

export interface CompleteOpts {
  stage: Stage;
  messages: OpenAI.ChatCompletionMessageParam[];
  jsonMode?: boolean;
  tools?: OpenAI.ChatCompletionTool[];
  routing: RoutingConfig;
  baseURL: string;
  apiKey: string;
}

export interface CompleteResult {
  content: string | null;
  toolCalls: OpenAI.ChatCompletionMessageToolCall[];
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function complete(opts: CompleteOpts): Promise<CompleteResult> {
  const client = new OpenAI({ baseURL: opts.baseURL, apiKey: opts.apiKey });
  const model = opts.routing.models[opts.stage];

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: opts.messages,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
      };

      const response = await client.chat.completions.create(params);
      const choice = response.choices[0];
      return {
        content: choice.message.content ?? null,
        toolCalls: choice.message.tool_calls ?? [],
      };
    } catch (err: any) {
      // Retry on rate-limit (429) or transient server errors (5xx)
      const status = err?.status ?? err?.response?.status;
      if (status === 429 || (status >= 500 && status < 600)) {
        lastErr = err;
        const delay = BASE_DELAY_MS * 2 ** attempt;
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function parseJson<T>(content: string | null): T {
  if (!content) throw new Error('Empty LiteLLM response');
  const cleaned = content.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim();
  return JSON.parse(cleaned) as T;
}
