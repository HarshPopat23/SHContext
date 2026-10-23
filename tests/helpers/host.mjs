import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRepository, submitRepository } from '../../dist/index.js';
export { snapshot } from './verification.mjs';
export function hostFixture(t, { unsupported = false, empty = false } = {}) {
  const box = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), 'shcontext host ')),
  );
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  const root = join(box, 'repo');
  fs.mkdirSync(root);
  put(
    root,
    'shcontext.config.json',
    JSON.stringify({
      version: 1,
      provider: { id: 'host', model: 'claude-code-session' },
    }),
  );
  put(root, '.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
  if (!empty) {
    put(
      root,
      'auth/session.ts',
      'export function verifySession(token: string) { return token.startsWith("signed:"); }\n',
    );
    put(
      root,
      'routes/login.ts',
      'import { verifySession } from "../auth/session";\nexport const login = (token: string) => verifySession(token);\n',
    );
    put(root, 'unrelated/info.ts', 'export const info = 1;\n');
  }
  if (unsupported) put(root, 'legacy/tool.py', 'print("inventory only")\n');
  return { root, box, session: join(box, 'session') };
}
export function put(root, path, text) {
  const out = join(root, path);
  fs.mkdirSync(join(out, '..'), { recursive: true });
  fs.writeFileSync(out, text);
}
export const readRequest = (dir) =>
  JSON.parse(fs.readFileSync(join(dir, 'request.json'), 'utf8'));
export const readState = (dir) =>
  JSON.parse(fs.readFileSync(join(dir, 'session.json'), 'utf8'));
// Authored protocol controls, not a real-host quality evaluation.
export function envelope(request) {
  const { input } = request;
  const ids = input.evidence.map((x) => x.id);
  return {
    session_id: request.session_id,
    request_id: request.request_id,
    draft: {
      purpose: [
        {
          kind: 'inference',
          text: 'Groups the supplied source responsibilities.',
          evidence_ids: ids,
          rationale: 'Based on inspected direct source and child summaries.',
        },
      ],
      files: input.sources.map((source) => ({
        path: source.path,
        claims: [
          {
            kind: 'observed',
            text: source.path.endsWith('session.ts')
              ? 'Checks whether a token starts with the signed prefix.'
              : source.path.endsWith('login.ts')
                ? 'Delegates token checking to the imported session verifier.'
                : 'Declares an exported numeric constant.',
            evidence_ids: [source.evidence_id],
            rationale: null,
          },
        ],
      })),
      feature_flows: [],
      tests: [],
      uncertainty: ['Runtime integration and test execution were not checked.'],
    },
  };
}
export async function complete(root, session, options) {
  let result = await prepareRepository(root, session, options);
  const requests = [];
  while (result.status === 'awaiting_draft') {
    const request = readRequest(session);
    requests.push(request);
    result = await submitRepository(root, session, envelope(request));
  }
  return { result, requests };
}
