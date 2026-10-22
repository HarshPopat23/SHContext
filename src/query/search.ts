import type { QueryMatch } from './types.js';
import type { DependencyEdge } from '../core/contracts/index.js';
import { byteOrder } from '../scanner/filesystem.js';

const stop = new Set(
  'a an and are as at be by can code do does explain file files find for from handled handles how i in is it me of on or please repository show that the this to used uses using what when where which who with work works'.split(
    ' ',
  ),
);
/** Small declared retrieval expansions, not behavioral equivalences. */
const expansions: Record<string, string[]> = {
  authentication: ['auth', 'authenticate', 'login', 'signin', 'session'],
  authenticate: ['auth', 'authentication', 'login', 'session'],
  auth: ['authentication', 'authenticate', 'login', 'session'],
  login: ['auth', 'authentication', 'signin', 'session'],
  authorization: ['authorize', 'permission', 'permissions', 'access'],
};
export function tokens(text: string): string[] {
  return (
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
export function terms(question: string): string[] {
  const direct = tokens(question).filter((token) => !stop.has(token));
  return [
    ...new Set(
      direct.flatMap((token) => [token, ...(expansions[token] ?? [])]),
    ),
  ];
}
export function score(text: string, wanted: string[]): number {
  const words = new Set(tokens(text));
  return wanted.reduce((total, word) => total + Number(words.has(word)), 0);
}
export function order(
  a: Pick<QueryMatch, 'score' | 'path'>,
  b: Pick<QueryMatch, 'score' | 'path'>,
): number {
  return b.score - a.score || byteOrder(a.path, b.path);
}
/** Traverse confirmed file targets only; unresolved/external references never create neighbors. */
export function neighbors(
  seeds: string[],
  edges: DependencyEdge[],
  depth: number,
  limit: number,
) {
  const visited = new Set(seeds),
    selected: string[] = [];
  let frontier = seeds,
    truncated = false;
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (edge.resolution !== 'resolved') continue;
      if (frontier.includes(edge.from) && !visited.has(edge.to))
        next.add(edge.to);
      if (frontier.includes(edge.to) && !visited.has(edge.from))
        next.add(edge.from);
    }
    frontier = [...next].sort(byteOrder);
    for (const path of frontier) {
      if (selected.length >= limit) {
        truncated = true;
        continue;
      }
      visited.add(path);
      selected.push(path);
    }
    frontier = frontier.filter((path) => visited.has(path));
    if (!frontier.length) break;
  }
  return { paths: selected, truncated };
}
