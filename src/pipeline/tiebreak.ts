import { complete, parseJson } from '../lib/litellm.js';
import type { RepoCandidate, RouteResult } from './route.js';
import type { ClassifyResult } from './classify.js';
import type { RoutingConfig, RepoConfig } from '../config.js';

interface TiebreakResponse {
  repoName: string;
  labels: string[];
  reasoning: string;
}

export async function tiebreakRepo(
  candidates: RepoCandidate[],
  classification: ClassifyResult,
  routing: RoutingConfig,
  litellmConfig: { baseURL: string; apiKey: string },
): Promise<RouteResult> {
  const candidateDescriptions = candidates.map(c =>
    `- ${c.repo.name} (keywords: ${c.repo.keywords.join(', ')}, score: ${c.score})`
  ).join('\n');

  const result = await complete({
    stage: 'tiebreak',
    messages: [
      {
        role: 'system',
        content: 'You are a routing assistant. Choose the best repository for a reported issue. Respond with ONLY a JSON object (no markdown): {"repoName": "owner/repo", "labels": ["label1"], "reasoning": "one sentence"}',
      },
      {
        role: 'user',
        content: `Choose the best repository for this issue:\n\nSummary: ${classification.summary}\nCategory: ${classification.category}\nKeywords: ${classification.keywords.join(', ')}\n\nCandidates:\n${candidateDescriptions}`,
      },
    ],
    jsonMode: true,
    routing,
    ...litellmConfig,
  });

  const parsed = parseJson<TiebreakResponse>(result.content);

  const winner = candidates.find(c => c.repo.name === parsed.repoName)?.repo
    ?? routing.default;

  // Merge model-suggested labels with repo's default labels
  const repoLabels = (winner as RepoConfig).labels ?? routing.default.labels;
  const mergedLabels = [...new Set([...repoLabels, ...(parsed.labels ?? [])])];

  return {
    candidates,
    winner: { ...winner, labels: mergedLabels },
    tied: false,
  };
}
