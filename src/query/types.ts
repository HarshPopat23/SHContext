import type {
  DependencyEdge,
  ExtractedSymbol,
  SourceSpan,
  VerificationResult,
} from '../core/contracts/index.js';

export interface QueryOptions {
  /** Maximum returned files and summaries, 1–20. */
  limit?: number;
  /** Resolved incoming/outgoing file-reference hops, 0–3. */
  depth?: number;
}
export interface QueryMatch {
  path: string;
  score: number;
  reasons: ('path' | 'symbol' | 'text' | 'summary' | 'dependency')[];
  disposition: string;
  inspection: 'source' | 'documentation' | 'configuration' | 'inventory-only';
  symbols: ExtractedSymbol[];
  references: SourceSpan[];
  excerpt: string;
  excerpt_truncated: boolean;
}
export interface QuerySummary {
  source_path: string;
  path: string;
  freshness: VerificationResult['state'];
  /** Generated narrative for navigation, never a certificate of source behavior. */
  excerpt: string;
  references: SourceSpan[];
}
export interface QueryResult {
  schema_version: 1;
  question: string;
  input_id: string;
  status:
    | 'answered'
    | 'no_match'
    | 'context_missing'
    | 'context_stale'
    | 'context_unknown'
    | 'context_invalid';
  context: VerificationResult;
  answer: string;
  matches: QueryMatch[];
  summaries: QuerySummary[];
  relationships: DependencyEdge[];
  traversal: { depth: number; truncated: boolean };
  limitations: string[];
}
