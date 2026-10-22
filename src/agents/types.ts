import type { SourceSpan } from '../core/contracts/index.js';
import type { CancellationSignal } from '../providers/index.js';

export type AgentRole =
  'Coordinator' | 'Folder Analyst' | 'Architecture Analyst' | 'Verifier';
export const AGENT_ROLES: Readonly<Record<AgentRole, string>> = Object.freeze({
  Coordinator:
    'Assign bounded work, reserve budgets, assemble results and own publication.',
  'Folder Analyst':
    'Summarize bounded direct folders from supplied evidence without filesystem writes.',
  'Architecture Analyst':
    'Synthesize root purpose and project flows from child evidence and the declared graph.',
  Verifier:
    'Check source evidence and optionally review every narrative claim against supplied source.',
});
export interface AgentBudget {
  maxRequests?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  outputTokensPerRequest?: number;
  /** Reservation using caller-supplied prices, not an invoice guarantee. */
  maxCostUSD?: number;
  inputUSDPerMillion?: number;
  outputUSDPerMillion?: number;
}
export interface ExecutionOptions {
  workers?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  budget?: AgentBudget;
}
export interface AgentReview {
  source_path: string;
  mode: 'mechanical' | 'model-assisted';
  status: 'not-reviewed' | 'no-issues-found' | 'concerns';
  claims: number;
  findings: {
    claim_id: string;
    verdict: 'supported' | 'contradicted' | 'insufficient';
    evidence_ids: string[];
    explanation: string;
    text: string;
    references: SourceSpan[];
  }[];
}
export interface ExecutionReport {
  workers: number;
  peak_requests: number;
  requests: number;
  retries: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  reserved_cost_usd: number | null;
  tasks: {
    role: AgentRole;
    source_path: string;
    state: 'completed' | 'reused';
    requests: number;
  }[];
  reviews: AgentReview[];
}
export interface CoordinatorOptions extends ExecutionOptions {
  signal?: CancellationSignal;
}
