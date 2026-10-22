export { getProjectInfo } from './project-info.js';
export type { ProjectInfo } from './project-info.js';
export * from './contracts/index.js';
export { analyzeRepository } from './analyze-repository.js';
export type { AnalysisOptions } from './analyze-repository.js';
export { buildRepository, BuildError } from '../generation/index.js';
export type { BuildOptions, BuildResult } from '../generation/index.js';
export { verifyRepository } from '../validation/index.js';
export { updateRepository } from '../update/index.js';
export type { UpdateResult, SourceChanges } from '../update/index.js';
export { queryRepository, QueryError } from '../query/index.js';
export type {
  QueryOptions,
  QueryResult,
  QueryMatch,
  QuerySummary,
} from '../query/index.js';
export {
  AGENT_ROLES,
  ReviewError,
  AgentExecutionError,
} from '../agents/index.js';
export type {
  ExecutionOptions,
  ExecutionReport,
  AgentBudget,
  AgentRole,
  AgentReview,
} from '../agents/index.js';
