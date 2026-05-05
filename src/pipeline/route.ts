import type { RoutingConfig, RepoConfig } from '../config.js';
import type { ClassifyResult } from './classify.js';
import type { GmailThread } from './types.js';

export interface RepoCandidate {
  repo: RepoConfig;
  score: number;
}

export interface RouteResult {
  candidates: RepoCandidate[];
  winner: RepoConfig;
  tied: boolean;
}

export function routeThread(
  thread: GmailThread,
  classification: ClassifyResult,
  routing: RoutingConfig,
): RouteResult {
  const haystack = [
    thread.subject,
    thread.body.slice(0, 1000),
    ...classification.keywords,
    classification.summary,
  ].join(' ').toLowerCase();

  const scored: RepoCandidate[] = routing.repos.map(repo => {
    const score = repo.keywords.reduce((acc, kw) => {
      return acc + (haystack.includes(kw.toLowerCase()) ? 1 : 0);
    }, 0);
    return { repo, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { candidates: [], winner: routing.default, tied: false };
  }

  const top = scored[0].score;
  const topCandidates = scored.filter(c => c.score === top);
  const tied = topCandidates.length > 1;

  return {
    candidates: scored,
    winner: topCandidates[0].repo,
    tied,
  };
}
