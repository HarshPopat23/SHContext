import {
  lstatSync,
  realpathSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import {
  resolve,
  dirname,
  basename,
  join,
  relative,
  sep,
  isAbsolute,
} from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  HostSessionSchema,
  HostRequestSchema,
  type HostRequest,
  HostSubmissionSchema,
  type HostSession,
  type HostSubmission,
} from '../core/contracts/index.js';
import { scanRepository } from '../scanner/index.js';
import { analyzeRepository } from '../core/analyze-repository.js';
import { readBounded, decode, digest } from '../scanner/filesystem.js';
import { strictJson } from '../validation/json.js';
import { Coordinator } from '../agents/coordinator.js';
import {
  readOwnedTree,
  withPublicationLock,
  publish,
} from '../storage/publication.js';
import type { SummaryRequest, ModelProvider } from '../providers/index.js';
import { summarize, generationIdentity, generationId } from './summarize.js';
import { assembleGeneration } from './assembly.js';
import { BuildError } from './errors.js';

const MAX_STATE = 8 * 1_048_576;
const MAX_REQUEST = 524_288;
const MAX_SUBMISSION = 65_536;
function fail(code: string, message: string): never {
  throw new BuildError(code, message);
}
const exists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
const outside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
};
function rootPath(selected: string): string {
  const path = resolve(selected),
    stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail('host_root', 'Select a real repository directory.');
  return realpathSync(path);
}
function sessionPath(root: string, selected: string): string {
  const requested = resolve(selected);
  const path = join(realpathSync(dirname(requested)), basename(requested));
  if (!outside(root, path))
    fail(
      'host_session_path',
      'Session directories must be outside the selected repository.',
    );
  if (exists(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail(
        'host_session_path',
        'Session must be a real directory, never a link.',
      );
  }
  return path;
}
function readJson(path: string, limit: number): unknown {
  const parent = realpathSync(dirname(path)),
    file = join(parent, basename(path));
  if (lstatSync(file).nlink !== 1)
    fail(
      'host_session_invalid',
      'Host files must be single-link regular files.',
    );
  const read = readBounded(parent, file, limit);
  if (read.oversized)
    fail(
      'host_size_limit',
      'Host file exceeds its bounded size; narrow the selected root or shorten the draft.',
    );
  return strictJson(decode(read.bytes));
}
function atomicJson(
  dir: string,
  name: 'session' | 'request',
  value: unknown,
  limit: number,
): void {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > limit)
    fail(
      'host_size_limit',
      'Host state/evidence exceeds its bounded size; narrow the selected root. No input was truncated.',
    );
  const destination = join(dir, name + '.json'),
    temporary = join(dir, name + '.tmp');
  if (exists(destination)) {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      fail(
        'host_session_invalid',
        'Host output is linked or not a regular file.',
      );
  }
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true });
  renameSync(temporary, destination);
}
async function withSession<T>(
  dir: string,
  create: boolean,
  work: () => Promise<T>,
): Promise<T> {
  if (!exists(dir)) {
    if (!create) fail('host_session_missing', 'Prepare a host session first.');
    mkdirSync(dir, { mode: 0o700 });
  }
  const known = new Set([
    'session.json',
    'request.json',
    'response.json',
    'session.lock',
  ]);
  if (readdirSync(dir).some((name) => !known.has(name)))
    fail(
      'host_session_invalid',
      'Session permits session.json, request.json, response.json and session.lock only. Unknown or interrupted files require inspection; no files were removed.',
    );
  const lock = join(dir, 'session.lock'),
    token = randomUUID();
  try {
    writeFileSync(lock, token, { flag: 'wx', mode: 0o600, flush: true });
  } catch {
    fail(
      'host_session_locked',
      'Another operation or interrupted writer owns this session. Inspect session.lock before retrying.',
    );
  }
  try {
    return await work();
  } finally {
    try {
      const read = readBounded(dir, lock, 128);
      if (
        !read.oversized &&
        read.bytes.toString() === token &&
        lstatSync(lock).nlink === 1
      )
        rmSync(lock);
    } catch {
      /* Preserve uncertain lock ownership. */
    }
  }
}
function idle(root: string): void {
  const path = join(root, '.shcontext');
  if (
    exists(path) &&
    (!lstatSync(path).isDirectory() ||
      lstatSync(path).isSymbolicLink() ||
      readdirSync(path).length)
  )
    fail(
      'host_publication_active',
      'Publication is active or interrupted. Finalize/recover its recorded transaction; prepare/submit never recover output.',
    );
}
function inspect(root: string) {
  const scan = scanRepository(root);
  if (scan.configuration.provider?.id !== 'host')
    fail(
      'host_configuration',
      'Host mode requires provider {"id":"host","model":"claude-code-session"} in shcontext.config.json. The model label records host-declared provenance, not a verified API model.',
    );
  const report = analyzeRepository(root, {
    expectedInputId: scan.inventory.input_id,
  });
  return {
    scan,
    generation_id: generationId(generationIdentity(scan, report)),
    owned: readOwnedTree(root),
  };
}
function load(dir: string, root: string): HostSession {
  const parsed = HostSessionSchema.safeParse(
    readJson(join(dir, 'session.json'), MAX_STATE),
  );
  if (!parsed.success || parsed.data.root !== root)
    fail(
      'host_session_invalid',
      'Session format or selected repository does not match.',
    );
  return parsed.data;
}
function checkSnapshot(root: string, state: HostSession) {
  const current = inspect(root);
  if (
    current.scan.inventory.input_id !== state.input_id ||
    current.generation_id !== state.generation_id
  )
    fail(
      'host_snapshot_changed',
      'Source, selection or installed generation components changed. Preserve this session and prepare a new one.',
    );
  return current;
}
class Pending extends Error {
  constructor(readonly request: HostRequest) {
    super('Host draft required.');
  }
}
async function replay(root: string, state: HostSession) {
  const { scan, owned } = checkSnapshot(root, state);
  if ((owned?.identity ?? null) !== state.context_identity)
    fail(
      'host_output_changed',
      'Published context changed since preparation; prepare a new session.',
    );
  let cursor = 0;
  const provider: ModelProvider = {
    identity: scan.configuration.provider!,
    generate: async (request: SummaryRequest) => {
      const input: unknown = strictJson(request.input);
      const source_path = (input as { source_path: string }).source_path;
      const request_id = digest(
        JSON.stringify([
          state.session_id,
          state.input_id,
          state.generation_id,
          state.context_identity,
          state.operation,
          request.role,
          request.instructions,
          request.input,
          request.schema,
          request.max_output_tokens,
        ]),
      );
      const next = HostRequestSchema.parse({
        protocol: 1,
        session_id: state.session_id,
        request_id,
        source_path,
        role: request.role!,
        instructions: request.instructions,
        input,
        draft_schema: request.schema,
      });
      if (Buffer.byteLength(JSON.stringify(next, null, 2) + '\n') > MAX_REQUEST)
        fail(
          'host_size_limit',
          'Folder evidence exceeds 512 KiB. Narrow the selected root; no input was truncated.',
        );
      const answer = state.answers[cursor++];
      if (!answer) throw new Pending(next);
      if (
        answer.session_id !== state.session_id ||
        answer.request_id !== request_id
      )
        fail(
          'host_submission_mismatch',
          'Submission order or request binding does not match current evidence.',
        );
      return answer.draft;
    },
  };
  const coordinator = new Coordinator(provider);
  try {
    const collected = await summarize(
      root,
      scan,
      coordinator.signal,
      state.operation === 'update' ? owned?.cache : null,
      coordinator,
      1,
    );
    if (cursor !== state.answers.length)
      fail('host_submission_mismatch', 'Session contains unused submissions.');
    const assembled = assembleGeneration(
      root,
      scan,
      collected,
      state.operation === 'update' ? owned : null,
    );
    return { status: 'ready' as const, assembled, collected };
  } catch (error) {
    if (!(error instanceof Pending)) throw error;
    // A pending request interrupts summarize before its final comparison, so recheck here.
    const end = checkSnapshot(root, state);
    if ((end.owned?.identity ?? null) !== state.context_identity)
      fail(
        'host_output_changed',
        'Output changed while preparing folder evidence.',
      );
    return { status: 'awaiting_draft' as const, request: error.request };
  } finally {
    coordinator.close();
  }
}
function publicStatus(
  dir: string,
  state: HostSession,
  status: 'awaiting_draft' | 'ready' | 'published',
) {
  return {
    status,
    session_id: state.session_id,
    session_directory: dir,
    request_file: join(dir, 'request.json'),
    host_drafts: state.answers.length,
    input_id: state.input_id,
    generation_id: state.generation_id,
    actual_host_tokens: null,
    actual_host_cost_usd: null,
  };
}
function save(
  dir: string,
  state: HostSession,
  next: Awaited<ReturnType<typeof replay>>,
): void {
  atomicJson(dir, 'session', HostSessionSchema.parse(state), MAX_STATE);
  atomicJson(
    dir,
    'request',
    next.status === 'awaiting_draft'
      ? next.request
      : publicStatus(dir, state, 'ready'),
    MAX_REQUEST,
  );
}
function finished(root: string, state: HostSession): boolean {
  const current = checkSnapshot(root, state);
  if (
    state.publication_hash &&
    current.owned?.identity === state.publication_hash
  )
    return true;
  if (state.completed)
    fail(
      'host_output_changed',
      'Completed session output no longer matches; prepare a new session.',
    );
  return false;
}
/** Prepare/resume one bounded folder at a time. No provider/network calls or publication. */
export async function prepareRepository(
  selectedRoot: string,
  selectedSession: string,
  options: { update?: boolean } = {},
) {
  const root = rootPath(selectedRoot),
    dir = sessionPath(root, selectedSession);
  idle(root);
  return withSession(dir, true, async () => {
    let state: HostSession;
    if (exists(join(dir, 'session.json'))) {
      state = load(dir, root);
      if (state.operation !== (options.update ? 'update' : 'build'))
        fail(
          'host_operation_mismatch',
          'Resume with the original build/update mode.',
        );
      if (finished(root, state)) {
        state.completed = true;
        atomicJson(dir, 'session', state, MAX_STATE);
        atomicJson(
          dir,
          'request',
          publicStatus(dir, state, 'published'),
          MAX_REQUEST,
        );
        return publicStatus(dir, state, 'published');
      }
    } else {
      if (readdirSync(dir).some((name) => name !== 'session.lock'))
        fail(
          'host_session_invalid',
          'Existing directory does not contain an owned session.',
        );
      const current = inspect(root);
      state = {
        version: 1,
        session_id: randomUUID(),
        root,
        operation: options.update ? 'update' : 'build',
        input_id: current.scan.inventory.input_id,
        generation_id: current.generation_id,
        context_identity: current.owned?.identity ?? null,
        answers: [],
        publication_hash: null,
        completed: false,
      };
    }
    const next = await replay(root, state);
    save(dir, state, next);
    return publicStatus(dir, state, next.status);
  });
}
/** Accept an envelope bound to the current request; reject invalid drafts without changing state. */
export async function submitRepository(
  selectedRoot: string,
  selectedSession: string,
  submission: HostSubmission,
) {
  const root = rootPath(selectedRoot),
    dir = sessionPath(root, selectedSession);
  idle(root);
  return withSession(dir, false, async () => {
    const state = load(dir, root),
      parsed = HostSubmissionSchema.safeParse(submission);
    if (state.completed || state.publication_hash)
      fail(
        'host_session_complete',
        'Session is finalized or has a publication intent; resume/finalize it instead.',
      );
    if (
      !parsed.success ||
      Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_SUBMISSION
    )
      fail(
        'host_submission_invalid',
        'Submission needs session_id, request_id and a bounded draft object (64 KiB maximum).',
      );
    const pending = await replay(root, state);
    if (pending.status !== 'awaiting_draft')
      fail(
        'host_session_ready',
        'All required drafts are present; finalize instead.',
      );
    if (
      parsed.data.session_id !== state.session_id ||
      parsed.data.request_id !== pending.request.request_id
    )
      fail(
        'host_submission_mismatch',
        'Submission belongs to another session or request.',
      );
    const candidate = HostSessionSchema.parse({
      ...state,
      answers: [...state.answers, parsed.data],
    });
    const next = await replay(root, candidate);
    save(dir, candidate, next);
    return publicStatus(dir, candidate, next.status);
  });
}
/** Explicit bounded local JSON input; no repository script or external endpoint is executed. */
export function readHostSubmission(path: string): HostSubmission {
  const parsed = HostSubmissionSchema.safeParse(
    readJson(resolve(path), MAX_SUBMISSION),
  );
  if (!parsed.success)
    fail(
      'host_submission_invalid',
      'Expected a strict session_id/request_id/draft envelope.',
    );
  return parsed.data;
}
/** Only finalization holds the existing publication lock and invokes the shared staged writer. */
export async function finalizeRepository(
  selectedRoot: string,
  selectedSession: string,
) {
  const root = rootPath(selectedRoot),
    dir = sessionPath(root, selectedSession);
  return withSession(dir, false, async () =>
    withPublicationLock(root, async (initial) => {
      const state = load(dir, root);
      if (finished(root, state)) {
        state.completed = true;
        atomicJson(dir, 'session', state, MAX_STATE);
        atomicJson(
          dir,
          'request',
          publicStatus(dir, state, 'published'),
          MAX_REQUEST,
        );
        return {
          ...publicStatus(dir, state, 'published'),
          changed: false,
          coverage: readOwnedTree(root)!.manifest.coverage,
          recovered: true,
        };
      }
      if (initial !== state.context_identity)
        fail('host_output_changed', 'Output changed since preparation.');
      const next = await replay(root, state);
      if (next.status !== 'ready')
        fail(
          'host_incomplete',
          'A folder draft is missing; submit it before finalizing.',
        );
      const { assembled, collected } = next;
      state.publication_hash = digest(
        assembled.outputs.get('context/.shcontext/manifest.json')!,
      );
      // Persist intent before publication so an interrupted completion write can be resumed safely.
      atomicJson(dir, 'session', state, MAX_STATE);
      if (!assembled.unchanged)
        publish(root, assembled.outputs, initial, () => {
          const current = checkSnapshot(root, state);
          if ((current.owned?.identity ?? null) !== initial)
            fail('host_output_changed', 'Output changed before publication.');
        });
      else checkSnapshot(root, state);
      if (readOwnedTree(root)?.identity !== state.publication_hash)
        fail(
          'host_output_changed',
          'Published output does not match the validated host result.',
        );
      state.completed = true;
      atomicJson(dir, 'session', state, MAX_STATE);
      atomicJson(
        dir,
        'request',
        publicStatus(dir, state, 'published'),
        MAX_REQUEST,
      );
      return {
        ...publicStatus(dir, state, 'published'),
        changed: !assembled.unchanged,
        coverage: assembled.bundle.inventory.coverage,
        regenerated: collected.regenerated,
        reused: collected.reused,
        changes: assembled.changes,
        output_paths: [...assembled.outputs.keys()],
      };
    }),
  );
}
