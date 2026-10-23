import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test, { before, after } from 'node:test';
import { envelope } from './helpers/host.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const box = fs.mkdtempSync(join(tmpdir(), 'shcontext web distribution '));
const pack = join(box, 'package');
const env = {
  ...process.env,
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  NODE_OPTIONS: '',
  NODE_PATH: '',
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
};
const run = (command, args, expected = 0, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 90000,
    env,
    cwd: box,
    ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, result.stdout + '\n' + result.stderr);
  return result;
};
const python = run(process.platform === 'win32' ? 'python' : 'python3', [
  '-c',
  'import sys; print(sys.executable)',
]).stdout.trim();
const tools = join(box, 'executables');
fs.mkdirSync(tools);
// Consumers have no npm, Git, globally installed packages or source-checkout resolution.
fs.copyFileSync(
  process.execPath,
  join(tools, process.platform === 'win32' ? 'node.exe' : 'node'),
);
const offline = { ...env, PATH: tools };
const installed = {};
before(() => {
  // A checkout contains files, not empty directories left behind by skill scaffolding.
  const checkout = join(box, 'fresh source checkout');
  run('git', ['clone', '--shared', '--no-checkout', repo, checkout]);
  const paths = run(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    0,
    { cwd: repo },
  )
    .stdout.split('\0')
    .filter(Boolean);
  for (const path of paths) {
    fs.mkdirSync(dirname(join(checkout, path)), { recursive: true });
    fs.copyFileSync(join(repo, path), join(checkout, path));
  }
  assert.equal(
    fs.existsSync(join(checkout, 'skills-web/context-web-build/references')),
    false,
  );
  // Producer dependencies are prepared already; consumers still receive production modules only.
  fs.cpSync(join(repo, 'node_modules'), join(checkout, 'node_modules'), {
    recursive: true,
  });
  run(
    process.execPath,
    [join(checkout, 'scripts/package-web-skills.mjs'), pack],
    0,
    { cwd: checkout },
  );
  for (const operation of ['build', 'update', 'verify', 'query']) {
    const target = join(box, 'installed-' + operation);
    run(python, [
      '-c',
      'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
      join(pack, `context-web-${operation}.zip`),
      target,
    ]);
    installed[operation] = join(
      target,
      `context-web-${operation}`,
      'resources/web.py',
    );
  }
});
after(() => fs.rmSync(box, { recursive: true, force: true }));
const web = (operation, args, expected = 0, extra = {}) =>
  run(python, [installed[operation], ...args], expected, {
    env: offline,
    ...extra,
  });
const json = (operation, args, expected = 0) =>
  JSON.parse(web(operation, args, expected).stdout);
function source(name, overrides = {}) {
  const files = {
    '.shcontextignore': 'shcontext.config.json\n.shcontextignore\n',
    'auth/session.ts':
      'export function verifySession(token: string) { return token.startsWith("signed:"); }\n',
    'routes/login.ts':
      'import { verifySession } from "../auth/session";\nexport const login = (token: string) => verifySession(token);\n',
    'unrelated/info.ts': 'export const info = 1;\n',
    ...overrides,
  };
  const path = join(box, name + '.zip');
  run(python, [
    '-c',
    'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); [z.writestr(sys.argv[2]+"/"+k,v) for k,v in json.loads(sys.argv[3]).items() if v is not None]; z.close()',
    path,
    name,
    JSON.stringify(files),
  ]);
  return path;
}
function open(
  name,
  archive,
  previous,
  { prefix = name, subfolder = '.' } = {},
) {
  const work = join(box, name + '-workspace');
  const args = [
    'open',
    '--source',
    archive,
    '--work',
    work,
    '--repo-prefix',
    prefix,
    '--subfolder',
    subfolder,
  ];
  if (previous) args.push('--previous', previous);
  return { work, ...json(previous ? 'update' : 'build', args) };
}
function finish(work, operation = 'build', pending) {
  let state = pending ?? json(operation, ['prepare', '--work', work]);
  const paths = [];
  while (state.status === 'awaiting_draft') {
    const request = JSON.parse(fs.readFileSync(state.request_file));
    paths.push(request.source_path);
    const draft = join(box, 'draft.json');
    fs.writeFileSync(draft, JSON.stringify(envelope(request)));
    state = json(operation, ['submit', '--work', work, '--draft', draft]);
  }
  assert.equal(state.status, 'ready');
  const finalized = json(operation, ['finalize', '--work', work]);
  assert.equal(finalized.status, 'published');
  assert.equal(json(operation, ['verify', '--work', work]).state, 'fresh');
  return { paths, finalized };
}
function exportZip(work, name) {
  return json('build', [
    'export',
    '--work',
    work,
    '--output',
    join(box, name + '.zip'),
  ]).archive;
}

test('archive negative controls and positive controls pass', () => {
  assert.match(
    run(python, [join(repo, 'tests/web/test_archives.py')]).stdout,
    /ARCHIVE SAFETY PASSED/,
  );
});

test('independent activation results cover the current skill metadata and positive/negative corpus', () => {
  const record = JSON.parse(
    fs.readFileSync(
      join(repo, 'docs/examples/skills/web-forward-results.json'),
    ),
  );
  const fixture = fs.readFileSync(
    join(repo, 'tests/fixtures/web-skills/activation.json'),
  );
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(record.actual_claude_web, false);
  assert.equal(record.activation_fixture_sha256, digest(fixture));
  for (const [path, hash] of Object.entries(record.instruction_hashes))
    assert.equal(
      digest(fs.readFileSync(join(repo, path))),
      hash,
      'Rerun the independent forward test after changing skill instructions.',
    );
  const cases = JSON.parse(fixture);
  assert.equal(new Set(cases.map((x) => x.id)).size, cases.length);
  assert.deepEqual(
    record.activation_predictions.map((x) => x.id).sort(),
    cases.map((x) => x.id).sort(),
  );
  for (const item of cases)
    assert.equal(
      record.activation_predictions.find((x) => x.id === item.id).prediction,
      item.expected,
      item.prompt,
    );
  for (const operation of ['build', 'update', 'verify', 'query'])
    assert.ok(cases.some((x) => x.expected === 'context-web-' + operation));
  assert.ok(cases.some((x) => x.expected === null));
});

test('each independently uploadable skill contains its own locked runtime, licenses and instructions', () => {
  const manifest = JSON.parse(
    fs.readFileSync(join(pack, 'web-distribution.json')),
  );
  assert.equal(manifest.artifacts.length, 4);
  for (const artifact of manifest.artifacts) {
    const bytes = fs.readFileSync(join(pack, artifact.file));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      artifact.sha256,
    );
    const names = JSON.parse(
      run(python, [
        '-c',
        'import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',
        join(pack, artifact.file),
      ]).stdout,
    );
    const name = artifact.file.slice(0, -4);
    assert.ok(
      names.every(
        (x) => x.startsWith(name + '/') && !x.split('/').includes('..'),
      ),
    );
    for (const path of [
      'SKILL.md',
      'references/workflow.md',
      'resources/web.py',
      'resources/runtime/dist/web/runtime.js',
      'resources/runtime/LICENSE',
      'resources/runtime/licenses/zod/LICENSE',
      'resources/runtime/BUNDLE.json',
    ])
      assert.ok(names.includes(name + '/' + path), path);
    assert.ok(names.length <= 200, 'Claude upload file-count limit');
    assert.ok(
      names.every((path) => /^[a-zA-Z0-9_./-]+$/.test(path)),
      'Portable upload resource paths',
    );
    assert.ok(
      !names.some((path) => /\.(?:zip|skill)$/i.test(path)),
      'No nested archives',
    );
    assert.ok(
      !names.some((path) => path.includes('/node_modules/')),
      'Dependencies are bundled',
    );
    const skill = fs.readFileSync(
      join(
        dirname(installed[name.slice('context-web-'.length)]),
        '../SKILL.md',
      ),
      'utf8',
    );
    const description = skill.match(/^description: (.+)$/m)[1];
    assert.ok(description.length <= 200);
    assert.doesNotMatch(skill, /TODO|\/shcontext:|npm ci/);
    assert.ok(
      !names.some((x) =>
        /node_modules\/(?:typescript|prettier|@types)\//.test(x),
      ),
    );
  }
});

test('all four installed ZIPs import their production dependencies without npm or source checkout', () => {
  for (const operation of Object.keys(installed)) {
    const state = json(operation, ['preflight']);
    assert.equal(state.status, 'compatible');
    assert.equal(state.network_required, false);
  }
});

test('missing Node and incomplete bundle fail with actionable errors, never install', () => {
  const empty = join(box, 'empty-path');
  fs.mkdirSync(empty);
  const missing = web('build', ['preflight'], 1, {
    env: { ...offline, PATH: empty },
  });
  assert.match(missing.stderr, /runtime_unavailable/);
  const resources = dirname(installed.query);
  const dependency = join(resources, 'runtime/dist/index.js');
  fs.renameSync(dependency, dependency + '-missing');
  try {
    web('query', ['preflight'], 1);
  } finally {
    fs.renameSync(dependency + '-missing', dependency);
  }
});

test(
  'runtime rejects an untested Node version',
  {
    skip:
      process.platform === 'win32'
        ? 'POSIX executable shim; compatible runtime tested on Windows separately'
        : false,
  },
  () => {
    const shim = join(box, 'old-node');
    fs.mkdirSync(shim);
    fs.writeFileSync(join(shim, 'node'), '#!/bin/sh\nprintf "v18.20.0\\n"\n', {
      mode: 0o755,
    });
    assert.match(
      web('build', ['preflight'], 1, { env: { ...offline, PATH: shim } })
        .stderr,
      /runtime_incompatible/,
    );
  },
);

test('build, source references, export, changed-source import, selective update and zero-draft reuse cross fresh workspaces', () => {
  const first = open('headlamp-old', source('headlamp-old'));
  const built = finish(first.work);
  assert.deepEqual(built.paths, ['auth', 'routes', 'unrelated', '.']);
  const manifest = JSON.parse(
    fs.readFileSync(join(first.root, 'context/.shcontext/manifest.json')),
  );
  assert.deepEqual(manifest.generation.provider, {
    id: 'host',
    model: 'claude-web-session',
  });
  assert.ok(
    manifest.files.some((x) => x.path === 'auth/session.ts' && x.sha256),
  );
  assert.match(
    fs.readFileSync(join(first.root, 'context/auth/CONTEXT.md'), 'utf8'),
    /session.ts/,
  );
  const previous = exportZip(first.work, 'context-first');
  const exportedBytes = fs.readFileSync(previous);
  web('build', ['export', '--work', first.work, '--output', previous], 1);
  assert.deepEqual(fs.readFileSync(previous), exportedBytes);
  // No private session or source can leak into the downloadable output.
  const names = JSON.parse(
    run(python, [
      '-c',
      'import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',
      previous,
    ]).stdout,
  );
  assert.ok(names.includes('context/.shcontext/cache.json'));
  assert.ok(
    names.every((x) => x === 'web-context.json' || x.startsWith('context/')),
  );
  fs.rmSync(first.work, { recursive: true });
  const changedArchive = source('headlamp-new', {
    'auth/session.ts':
      'export function verifySession(token: string) { return token.startsWith("verified:"); }\n',
  });
  const changed = open('headlamp-new', changedArchive, previous);
  assert.equal(
    json('verify', ['verify', '--work', changed.work], 1).state,
    'stale',
  );
  assert.equal(
    json(
      'query',
      ['query', '--work', changed.work, '--question', 'verifySession'],
      1,
    ).status,
    'context_stale',
  );
  assert.throws(() => exportZip(changed.work, 'stale-export'));
  const updated = finish(changed.work, 'update');
  assert.deepEqual(updated.paths, ['auth', 'routes', '.']);
  assert.ok(updated.finalized.reused.includes('unrelated'));
  const next = exportZip(changed.work, 'context-updated');
  fs.rmSync(changed.work, { recursive: true });
  const again = open('headlamp-again', changedArchive, next, {
    prefix: 'headlamp-new',
  });
  assert.equal(json('verify', ['verify', '--work', again.work]).state, 'fresh');
  const answer = json('query', [
    'query',
    '--work',
    again.work,
    '--question',
    'verifySession',
  ]);
  assert.equal(answer.status, 'answered');
  assert.ok(
    answer.matches.some(
      (x) => x.path === 'auth/session.ts' && x.references.length,
    ),
  );
  const unchanged = finish(again.work, 'update');
  assert.deepEqual(unchanged.paths, []);
  assert.equal(unchanged.finalized.changed, false);
  const configuredArchive = source('configured', {
    'auth/session.ts':
      'export function verifySession(token: string) { return token.startsWith("verified:"); }\n',
    'shcontext.config.json': JSON.stringify({
      version: 1,
      folderWordLimit: 450,
      provider: { id: 'openai', model: 'optional-api-path' },
    }),
  });
  const originalBytes = fs.readFileSync(configuredArchive);
  const configured = open('configured', configuredArchive, next);
  assert.equal(
    json('verify', ['verify', '--work', configured.work], 1).state,
    'stale',
  );
  assert.deepEqual(finish(configured.work, 'update').paths, [
    'auth',
    'routes',
    'unrelated',
    '.',
  ]);
  assert.deepEqual(fs.readFileSync(configuredArchive), originalBytes);
});

test('bad drafts, missing drafts, interrupted work and source mutations never publish invalid output', () => {
  const fixture = open('draft-source', source('draft-source'));
  const pending = json('build', ['prepare', '--work', fixture.work]);
  const request = JSON.parse(fs.readFileSync(pending.request_file));
  const before = fs.readFileSync(join(fixture.work, 'session/session.json'));
  const bad = envelope(request);
  bad.draft.purpose[0].evidence_ids = ['invented'];
  const draft = join(box, 'bad-draft.json');
  fs.writeFileSync(draft, JSON.stringify(bad));
  web('build', ['submit', '--work', fixture.work, '--draft', draft], 1);
  assert.deepEqual(
    fs.readFileSync(join(fixture.work, 'session/session.json')),
    before,
  );
  web('build', ['finalize', '--work', fixture.work], 1);
  assert.equal(fs.existsSync(join(fixture.root, 'context')), false);
  // New processes resume a private session; no extra scratch entry is tolerated.
  assert.equal(
    json('build', ['prepare', '--work', fixture.work]).request_file,
    pending.request_file,
  );
  fs.writeFileSync(join(fixture.work, 'session/session.lock'), 'interrupted');
  assert.match(
    web('build', ['prepare', '--work', fixture.work], 1).stderr,
    /host_session_locked/,
  );
  fs.rmSync(join(fixture.work, 'session/session.lock'));
  fs.writeFileSync(
    join(fixture.root, 'auth/session.ts'),
    'export const changed = 1;\n',
  );
  assert.match(
    web('build', ['prepare', '--work', fixture.work], 1).stderr,
    /host_snapshot_changed/,
  );
  assert.equal(fs.existsSync(join(fixture.root, 'context')), false);
});

test('archive selections, existing output, Git metadata and corrupt previous contexts fail without a workspace', () => {
  const archive = source('selection');
  for (const subfolder of ['../escape', 'missing']) {
    const work = join(box, 'rejected-' + subfolder.replaceAll('/', '-'));
    web(
      'build',
      [
        'open',
        '--source',
        archive,
        '--work',
        work,
        '--repo-prefix',
        'selection',
        '--subfolder',
        subfolder,
      ],
      1,
    );
    assert.equal(fs.existsSync(work), false);
  }
  for (const [name, overrides] of [
    ['git', { '.git/config': '[core]' }],
    ['output', { 'context/unknown.txt': 'user file' }],
  ]) {
    const work = join(box, name + '-rejected');
    web(
      'build',
      [
        'open',
        '--source',
        source(name, overrides),
        '--work',
        work,
        '--repo-prefix',
        name,
      ],
      1,
    );
    assert.equal(fs.existsSync(work), false);
  }
  const fixture = open('prior', source('prior'));
  finish(fixture.work);
  const previous = exportZip(fixture.work, 'prior-output');
  const corrupt = join(box, 'corrupt.zip');
  run(python, [
    '-c',
    'import zipfile,sys; a=zipfile.ZipFile(sys.argv[1]); b=zipfile.ZipFile(sys.argv[2],"w"); [b.writestr(n,b"tampered" if n.endswith("auth/CONTEXT.md") else a.read(n)) for n in a.namelist()]; b.close()',
    previous,
    corrupt,
  ]);
  const work = join(box, 'corrupt-import');
  assert.match(
    web(
      'update',
      [
        'open',
        '--source',
        archive,
        '--work',
        work,
        '--repo-prefix',
        'selection',
        '--previous',
        corrupt,
      ],
      1,
    ).stderr,
    /output_ownership/,
  );
  assert.equal(fs.existsSync(work), false);
  const scopeWork = join(box, 'wrong-scope');
  web(
    'update',
    [
      'open',
      '--source',
      archive,
      '--work',
      scopeWork,
      '--repo-prefix',
      'selection',
      '--subfolder',
      'auth',
      '--previous',
      previous,
    ],
    1,
  );
  assert.equal(fs.existsSync(scopeWork), false);
});

test('subfolder scope is explicit and partial unsupported coverage is returned rather than hidden', () => {
  const archive = source('narrow', {
    'auth/legacy.py': 'print("unsupported")\n',
  });
  const fixture = open('narrow', archive, undefined, { subfolder: 'auth' });
  let state = json('build', ['prepare', '--work', fixture.work]);
  while (state.status === 'awaiting_draft') {
    const request = JSON.parse(fs.readFileSync(state.request_file));
    assert.equal(request.source_path, '.');
    const draft = join(box, 'partial-draft.json');
    fs.writeFileSync(draft, JSON.stringify(envelope(request)));
    state = json('build', ['submit', '--work', fixture.work, '--draft', draft]);
  }
  assert.equal(
    json('build', ['finalize', '--work', fixture.work], 2).coverage,
    'partial',
  );
  assert.equal(
    json('verify', ['verify', '--work', fixture.work], 2).state,
    'fresh',
  );
  const result = json('build', [
    'export',
    '--work',
    fixture.work,
    '--output',
    join(box, 'partial.zip'),
  ]);
  assert.equal(result.coverage, 'partial');
});

test('network denial is a tested positive control and bundled host pipeline runs under that denial', () => {
  const deny = pathToFileURL(join(repo, 'tests/helpers/deny-network.mjs')).href;
  assert.match(
    run(
      process.execPath,
      [
        '--import',
        deny,
        '--input-type=module',
        '-e',
        'await fetch("https://example.com")',
      ],
      1,
    ).stderr,
    /network forbidden/,
  );
  const fixture = open('no-network', source('no-network'));
  const bridge = join(dirname(installed.build), 'runtime/dist/web/runtime.js');
  const session = join(fixture.work, 'offline-session');
  const call = (operation, argument = '') =>
    JSON.parse(
      run(
        process.execPath,
        ['--import', deny, bridge, operation, fixture.root, session, argument],
        0,
        { env: offline },
      ).stdout,
    );
  let state = call('prepare');
  while (state.status === 'awaiting_draft') {
    const request = JSON.parse(fs.readFileSync(state.request_file));
    const draft = join(box, 'offline-draft.json');
    fs.writeFileSync(draft, JSON.stringify(envelope(request)));
    state = call('submit', draft);
  }
  assert.equal(call('finalize').status, 'published');
  assert.equal(call('verify').state, 'fresh');
  assert.equal(call('query', 'verifySession').status, 'answered');
});
