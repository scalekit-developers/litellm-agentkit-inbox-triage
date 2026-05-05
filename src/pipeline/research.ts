import { ScalekitClient } from '@scalekit-sdk/node';
import { complete } from '../lib/litellm.js';
import { callTool } from '../tools/agentkit.js';
import type { ClassifyResult } from './classify.js';
import type { RepoConfig, RoutingConfig } from '../config.js';
import { log } from '../lib/log.js';
import type OpenAI from 'openai';

export interface RelatedIssue {
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface ResearchResult {
  related: RelatedIssue[];
  searchQueries: string[];
}

const SYSTEM_PROMPT = `You are a GitHub issue researcher. Your job is to find existing issues related to a reported problem.

You have access to the github_search_issues tool. Use it to search for related issues.
When you have gathered enough information (or after at most 3 searches), respond with ONLY a JSON object:
{
  "done": true,
  "related": [{"number": 123, "title": "...", "url": "...", "state": "open"|"closed"}],
  "searchQueries": ["query1", "query2"]
}`;

const GITHUB_SEARCH_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'github_search_issues',
    description: 'Search GitHub issues in a repository',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo format' },
        query: { type: 'string', description: 'search query' },
      },
      required: ['repo', 'query'],
    },
  },
};

export async function researchRelatedIssues(
  client: ScalekitClient,
  classification: ClassifyResult,
  targetRepo: RepoConfig,
  routing: RoutingConfig,
  litellmConfig: { baseURL: string; apiKey: string },
  identifier: string,
  githubConnectionName: string,
): Promise<ResearchResult> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Find related GitHub issues for this problem:\n\nRepo: ${targetRepo.name}\nSummary: ${classification.summary}\nKeywords: ${classification.keywords.join(', ')}\nCategory: ${classification.category}`,
    },
  ];

  const searchQueries: string[] = [];
  const MAX_ROUNDS = 4;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await complete({
      stage: 'research',
      messages,
      tools: [GITHUB_SEARCH_TOOL],
      routing,
      ...litellmConfig,
    });

    // Check if the model emitted a done JSON response as text
    if (result.content) {
      try {
        const parsed = JSON.parse(result.content) as { done: boolean; related: RelatedIssue[]; searchQueries: string[] };
        if (parsed.done) {
          return { related: parsed.related ?? [], searchQueries: parsed.searchQueries ?? searchQueries };
        }
      } catch {
        // Not JSON — model may still be thinking; continue
      }
    }

    if (result.toolCalls.length === 0) break;

    // Push assistant message with tool_calls
    messages.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });

    // Execute each tool call
    for (const tc of result.toolCalls) {
      const args = JSON.parse(tc.function.arguments) as { repo: string; query: string };
      searchQueries.push(args.query);

      log.debug({ query: args.query, repo: args.repo }, 'research: searching github');

      let toolResult: unknown;
      try {
        toolResult = await callTool(client, githubConnectionName, 'github_search_issues', {
          owner: args.repo.split('/')[0],
          repo: args.repo.split('/')[1],
          query: args.query,
        }, identifier);
      } catch (err) {
        toolResult = { error: String(err) };
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  // Fallback: return empty if model didn't produce a clean done signal
  return { related: [], searchQueries };
}
