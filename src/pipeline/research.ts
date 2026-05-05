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

You have access to the github_issues_list tool. Use it to list issues filtered by labels and state.
Pick labels that match the keywords in the problem report. You can call the tool up to 3 times with different label combinations.
When you have gathered enough information, respond with ONLY a JSON object:
{
  "done": true,
  "related": [{"number": 123, "title": "...", "url": "...", "state": "open"|"closed"}],
  "searchQueries": ["labels used1", "labels used2"]
}`;

const GITHUB_LIST_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'github_issues_list',
    description: 'List GitHub issues in a repository, optionally filtered by labels and state',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name (without owner)' },
        labels: { type: 'string', description: 'Comma-separated label names to filter by' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state filter (default: open)' },
      },
      required: ['owner', 'repo'],
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
      tools: [GITHUB_LIST_TOOL],
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
      const args = JSON.parse(tc.function.arguments) as { owner: string; repo: string; labels?: string; state?: string };
      const labelDesc = args.labels ?? '(no labels)';
      searchQueries.push(`${args.owner}/${args.repo} labels:${labelDesc}`);

      log.debug({ labels: args.labels, owner: args.owner, repo: args.repo }, 'research: listing github issues');

      let toolResult: unknown;
      try {
        toolResult = await callTool(client, githubConnectionName, 'github_issues_list', {
          owner: args.owner,
          repo: args.repo,
          labels: args.labels,
          state: args.state ?? 'open',
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
