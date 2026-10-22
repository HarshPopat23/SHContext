import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { scanRepository, ScanError } from '../dist/scanner/index.js';
import { RepositoryInventorySchema } from '../dist/core/contracts/index.js';
const fixture = fileURLToPath(
  new URL('./fixtures/scanner/repository', import.meta.url),
);
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const expected = JSON.parse(
  readFileSync(new URL('./fixtures/scanner/expected.json', import.meta.url)),
);
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'shcontext scan '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, path, content = '') {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function entries(root) {
  return Object.fromEntries(
    scanRepository(root).inventory.entries.map((entry) => [entry.path, entry]),
  );
}
function reason(root) {
  return Object.fromEntries(
    Object.entries(entries(root)).map(([path, entry]) => [path, entry.reason]),
  );
}
function fail(root, code) {
  assert.throws(
    () => scanRepository(root),
    (error) => error instanceof ScanError && error.code === code,
  );
}
function invoke(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
  });
}
function snapshot(root) {
  const result = {};
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const local = path ? `${path}/${name}` : name,
        stat = lstatSync(join(root, local));
      result[local] = stat.isFile()
        ? {
            bytes: readFileSync(join(root, local)).toString('hex'),
            mtime: stat.mtimeMs,
            mode: stat.mode,
          }
        : stat.isDirectory()
          ? 'directory'
          : 'link';
      if (stat.isDirectory()) walk(local);
    }
  }
  walk();
  return result;
}

test('ordinary fixture matches every expected boundary and remains unchanged', (t) => {
  const root = temporary(t);
  cpSync(fixture, root, { recursive: true });
  const before = snapshot(root);
  const result = scanRepository(root);
  assert.deepEqual(reason(root), expected);
  assert.equal(result.inventory.coverage, 'partial');
  assert.ok(RepositoryInventorySchema.safeParse(result.inventory).success);
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(result, scanRepository(root));
  const main = result.inventory.entries.find((e) => e.path === 'src/main.ts');
  assert.equal(
    main.sha256,
    `sha256:${createHash('sha256')
      .update(readFileSync(join(root, 'src/main.ts')))
      .digest('hex')}`,
  );
});

test('CLI emits only contract JSON on stdout and uses complete/partial/error exit codes', (t) => {
  const root = temporary(t);
  put(root, 'README.md', '# Hi');
  let result = invoke(root, 'scan', '.');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).coverage, 'complete');
  assert.match(result.stderr, /Scan complete/);
  put(root, 'other.py', 'print(1)');
  result = invoke(root, 'scan', '.');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).coverage, 'partial');
  put(root, 'shcontext.config.json', '{"version":1,"unknown":true}');
  result = invoke(root, 'scan', '.');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /invalid_configuration/);
});
for (const args of [
  ['scan'],
  ['scan', '.', '.'],
  ['scan', '.', '--version'],
  ['scan', '.', '--unknown'],
])
  test(`CLI rejects invalid scan invocation ${JSON.stringify(args)}`, (t) => {
    const root = temporary(t),
      result = invoke(root, ...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  });
test('scan --help does not inspect an invalid configuration', (t) => {
  const root = temporary(t);
  put(root, 'shcontext.config.json', 'bad');
  const result = invoke(root, 'scan', '--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /scan <directory>/);
});

test('tracked files survive Git ignores; SHContext rules still exclude tracked files', (t) => {
  const root = temporary(t);
  git(root, 'init');
  put(root, '.gitignore', 'ignored/\n*.ts\n');
  put(root, 'ignored/tracked.ts', 'export const a=1;');
  put(root, 'ignored/untracked.ts', 'export const b=2;');
  put(root, 'tracked.ts', 'export const c=3;');
  put(root, 'excluded.ts', 'export const d=4;');
  git(root, 'add', '-f', 'ignored/tracked.ts', 'tracked.ts', 'excluded.ts');
  put(root, '.shcontextignore', 'excluded.ts\n!ignored/untracked.ts\n');
  const before = snapshot(root),
    data = reason(root);
  assert.equal(data['ignored/'], 'directory_enumerated');
  assert.equal(data['ignored/tracked.ts'], 'supported_source');
  assert.equal(data['ignored/untracked.ts'], 'gitignore');
  assert.equal(data['tracked.ts'], 'supported_source');
  assert.equal(data['excluded.ts'], 'shcontextignore');
  assert.deepEqual(snapshot(root), before);
  put(root, 'tracked.ts', 'export const changed=2;');
  assert.notEqual(
    entries(root)['tracked.ts'].sha256,
    `sha256:${createHash('sha256').update('export const c=3;').digest('hex')}`,
  );
});

test('nested patterns, negations, escaped spaces/hash and parent pruning match Git', (t) => {
  const root = temporary(t);
  git(root, 'init');
  put(
    root,
    '.gitignore',
    '*.tmp\n!keep.tmp\npruned/\n!pruned/child.ts\n\\#secret\nspace\\ \n',
  );
  put(root, 'a.tmp', 'drop');
  put(root, 'keep.tmp', 'keep');
  put(root, '#secret', 'drop');
  if (process.platform !== 'win32') put(root, 'space ', 'drop');
  put(root, 'pruned/child.ts', 'export const a=1');
  put(root, 'src/.gitignore', '!local.tmp\n/root.txt\n');
  put(root, 'src/local.tmp', 'keep');
  put(root, 'src/root.txt', 'drop');
  put(root, 'src/deep/root.txt', 'keep');
  const data = reason(root);
  for (const path of [
    'a.tmp',
    '#secret',
    ...(process.platform === 'win32' ? [] : ['space ']),
    'pruned/',
    'src/root.txt',
  ]) {
    assert.equal(data[path], 'gitignore', path);
    const oracle = spawnSync(
      'git',
      ['-C', root, 'check-ignore', '--no-index', path],
      { encoding: 'utf8' },
    );
    assert.equal(oracle.status, 0, path);
  }
  assert.equal(data['pruned/child.ts'], undefined);
  for (const path of ['keep.tmp', 'src/local.tmp', 'src/deep/root.txt'])
    assert.notEqual(data[path], 'gitignore', path);
});

test('Git metadata, global and info excludes do not expand the selected policy', (t) => {
  const root = temporary(t);
  git(root, 'init');
  put(root, '.git/info/exclude', 'info.txt\n');
  put(root, 'global.ignore', 'global.txt\n');
  git(root, 'config', 'core.excludesFile', join(root, 'global.ignore'));
  put(root, 'info.txt', 'included');
  put(root, 'global.txt', 'included');
  const data = reason(root);
  assert.equal(data['info.txt'], 'supported_text');
  assert.equal(data['global.txt'], 'supported_text');
  assert.equal(data['.git/'], 'vcs_metadata');
  assert.equal(data['.git/info/exclude'], undefined);
});

test('selected subdirectory reads current scoped files, without parent ignore rules', (t) => {
  const root = temporary(t);
  git(root, 'init');
  put(root, '.gitignore', 'sub/*.ts\n');
  put(root, 'outside.ts', 'export const outside=1;');
  put(root, 'sub/file.ts', 'export const inside=1;');
  git(root, 'add', '-f', 'sub/file.ts');
  put(root, 'sub/untracked.ts', 'export const extra=1;');
  const result = scanRepository(join(root, 'sub'));
  assert.deepEqual(
    result.inventory.entries.map((e) => e.path),
    ['.', 'file.ts', 'untracked.ts'],
  );
});

test('SHContext negation only undoes its own layer, and prunes excluded parents', (t) => {
  const root = temporary(t);
  put(root, '.gitignore', 'git.txt\n');
  put(
    root,
    '.shcontextignore',
    '*.txt\n!keep.txt\n!git.txt\n!node_modules/**\npruned/\n!pruned/child.ts\n',
  );
  for (const path of [
    'git.txt',
    'drop.txt',
    'keep.txt',
    'node_modules/a.txt',
    'pruned/child.ts',
  ])
    put(root, path, 'text');
  const data = reason(root);
  assert.equal(data['git.txt'], 'gitignore');
  assert.equal(data['drop.txt'], 'shcontextignore');
  assert.equal(data['keep.txt'], 'supported_text');
  assert.equal(data['node_modules/'], 'noise_directory');
  assert.equal(data['pruned/'], 'shcontextignore');
  assert.equal(data['pruned/child.ts'], undefined);
});

test('nested Git directories, gitfiles and uninitialized submodules are boundaries', (t) => {
  const root = temporary(t);
  git(root, 'init');
  put(root, 'nested/a.ts', 'export const a=1;');
  git(join(root, 'nested'), 'init');
  put(root, 'worktree/.git', 'gitdir: /not/read\n');
  put(root, 'worktree/a.ts', 'export const b=2;');
  mkdirSync(join(root, 'submodule'));
  git(
    root,
    'update-index',
    '--add',
    '--cacheinfo',
    '160000,1111111111111111111111111111111111111111,submodule',
  );
  const data = reason(root);
  for (const path of ['nested/', 'worktree/', 'submodule/'])
    assert.equal(data[path], 'nested_repository');
  assert.equal(data['nested/a.ts'], undefined);
});

test('reserved output/state never affect counts or identities', (t) => {
  const root = temporary(t);
  put(root, 'file.ts', 'export const a=1;');
  const before = scanRepository(root);
  put(root, 'context/CONTEXT.md', 'generated');
  put(root, '.shcontext/cache.json', '{}');
  assert.deepEqual(scanRepository(root), before);
  put(root, 'context/new.py', 'changed output');
  assert.deepEqual(scanRepository(root), before);
});

test('content gates classify binaries, invalid UTF-8, BOM, lockfiles and source maps', (t) => {
  const root = temporary(t);
  put(root, 'binary.ts', Buffer.from([65, 0, 66]));
  put(root, 'bad.md', Buffer.from([0xc3, 0x28]));
  put(root, 'bom.ts', Buffer.from('\ufeffexport const x=1;'));
  put(root, 'package-lock.json', 'bad lockfile');
  put(root, 'bundle.js.map', '{}');
  put(root, 'bundle.min.js', 'bad minified code');
  put(root, 'image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const data = reason(root);
  assert.equal(data['binary.ts'], 'binary');
  assert.equal(data['bad.md'], 'non_utf8');
  assert.equal(data['bom.ts'], 'supported_source');
  assert.equal(data['package-lock.json'], 'lockfile');
  assert.equal(data['bundle.js.map'], 'source_map');
  assert.equal(data['bundle.min.js'], 'generated_code');
  assert.equal(data['image.png'], 'binary');
  assert.equal(scanRepository(root).inventory.coverage, 'complete');
});

test('oversized files are partial; exact file limits pass', (t) => {
  const root = temporary(t);
  put(
    root,
    'shcontext.config.json',
    JSON.stringify({ version: 1, maxFileBytes: 1000, maxInputBytes: 2000 }),
  );
  put(root, 'exact.txt', 'a'.repeat(1000));
  put(root, 'large.txt', 'a'.repeat(1001));
  const data = entries(root);
  assert.equal(data['exact.txt'].reason, 'supported_text');
  assert.equal(data['large.txt'].reason, 'too_large');
  assert.equal(data['large.txt'].sha256, null);
  assert.equal(scanRepository(root).inventory.coverage, 'partial');
});
test('entry and readable-byte budgets fail the whole scan', (t) => {
  const root = temporary(t);
  put(root, 'shcontext.config.json', '{"version":1,"maxEntries":1}');
  fail(root, 'entry_limit');
  put(
    root,
    'shcontext.config.json',
    '{"version":1,"maxFileBytes":100,"maxInputBytes":100}',
  );
  put(root, 'a.txt', 'a'.repeat(80));
  fail(root, 'input_limit');
  assert.equal(invoke(root, 'scan', '.').stdout, '');
});
for (const config of [
  '{"version":1,"maxEntries":1,"maxEntries":2}',
  '{"version":1,"provider":{"id":"a","id":"b","model":"m"}}',
  '{"version":1,}',
  '{/*comment*/"version":1}',
  '{}',
  'null',
  '{"version":1,"maxInputBytes":1}',
  '{"version":1,"maxEntries":"10"}',
  '{"version":1,"provider":{"id":"a","model":"m","endpoint":"https://example.com"}}',
])
  test(`strict configuration rejects ${config}`, (t) => {
    const root = temporary(t);
    put(root, 'shcontext.config.json', config);
    fail(root, 'invalid_configuration');
  });

test('selection controls are read even if their inventory path is ignored', (t) => {
  const root = temporary(t);
  put(root, '.gitignore', '.gitignore\ndrop.txt\n');
  put(root, 'drop.txt', 'drop');
  const result = scanRepository(root);
  assert.equal(reason(root)['drop.txt'], 'gitignore');
  assert.ok(result.control_files.find((e) => e.path === '.gitignore').sha256);
  put(root, '.gitignore', Buffer.from([0xff]));
  fail(root, 'control_unreadable');
});

test('credential screening never emits matches, source text or sensitive digests', (t) => {
  const root = temporary(t);
  const fake = 'AKIA' + 'Z'.repeat(16);
  put(root, 'secret.ts', `export const token='${fake}';`);
  put(root, '.env.example', 'private');
  put(root, 'sub/identity.key', 'private');
  const data = entries(root);
  assert.equal(data['secret.ts'].reason, 'sensitive_content');
  assert.equal(data['secret.ts'].sha256, null);
  assert.equal(data['.env.example'].reason, 'sensitive_path');
  assert.equal(data['sub/identity.key'].reason, 'sensitive_path');
  const result = invoke(root, 'scan', '.');
  assert.equal(result.status, 2);
  assert.ok(!(result.stdout + result.stderr).includes(fake));
  assert.ok(!result.stdout.includes('export const'));
  put(root, '.gitignore', fake);
  fail(root, 'control_unreadable');
});

test('syntax checking covers JS/TS variants without running source or configs', (t) => {
  const root = temporary(t);
  for (const [path, text] of Object.entries({
    'module.mjs': 'export const a=1;',
    'script.cjs': 'module.exports = 1;',
    'types.d.ts': 'declare const a: string;',
    'types.d.mts': 'export declare const a: string;',
    'module.mts': 'export const a: number=1;',
    'script.cts': 'export = 1;',
    'view.jsx': 'export const V=()=> <div/>;',
    'run.ts': "throw new Error('must not execute');",
    'mdx.mdx': '<Uncompiled />',
    'config.json': 'malformed but inventory text',
  }))
    put(root, path, text);
  const result = scanRepository(root);
  assert.equal(result.inventory.coverage, 'complete');
  assert.ok(
    result.inventory.entries.every((e) => e.disposition === 'analyzed'),
  );
});

test('mechanical identities ignore timestamps but observe source, policy and inclusion changes', (t) => {
  const root = temporary(t);
  put(root, 'file.ts', 'export const a=1;');
  const original = scanRepository(root);
  put(root, 'file.ts', 'export const a=1;');
  assert.equal(
    scanRepository(root).inventory.input_id,
    original.inventory.input_id,
  );
  put(root, 'file.ts', 'export const a=2;');
  assert.notEqual(
    scanRepository(root).inventory.input_id,
    original.inventory.input_id,
  );
  put(root, 'file.ts', 'export const a=1;');
  put(root, '.shcontextignore', '# policy change\n');
  assert.notEqual(scanRepository(root).policy_id, original.policy_id);
});

test('ordinary directories do not require Git or provider credentials', (t) => {
  const root = temporary(t);
  put(root, 'file.ts', 'export const a=1;');
  put(
    root,
    'shcontext.config.json',
    '{"version":1,"provider":{"id":"unused","model":"unused"}}',
  );
  const result = spawnSync(process.execPath, [cli, 'scan', root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', Path: '' },
  });
  assert.equal(result.status, 0, result.stderr);
});
test('Git checkout fails visibly when tracking cannot be established', (t) => {
  const root = temporary(t);
  git(root, 'init');
  const result = spawnSync(process.execPath, [cli, 'scan', root], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', Path: '' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /git_unavailable/);
});

test('file/directory/dangling/cyclic symlinks are single boundaries', (t) => {
  const root = temporary(t),
    outside = temporary(t);
  put(outside, 'private.ts', 'export const outside=1;');
  put(root, 'file.ts', 'export const a=1;');
  try {
    symlinkSync(
      join(outside, 'private.ts'),
      join(root, 'file-link.ts'),
      'file',
    );
    symlinkSync(outside, join(root, 'dir-link'), 'junction');
    symlinkSync(join(root, 'missing'), join(root, 'dangling'), 'file');
    symlinkSync(root, join(root, 'cycle'), 'junction');
  } catch (error) {
    if (
      process.platform === 'win32' &&
      ['EPERM', 'EACCES'].includes(error.code)
    ) {
      t.skip('Host does not permit file symlinks');
      return;
    }
    throw error;
  }
  const data = entries(root);
  for (const path of ['file-link.ts', 'dir-link', 'dangling', 'cycle']) {
    assert.equal(data[path].reason, 'symlink');
    assert.equal(data[path].sha256, null);
  }
  assert.equal(data['dir-link/private.ts'], undefined);
  symlinkSync(outside, join(root, 'context'), 'junction');
  fail(root, 'output_symlink');
});
test('symlinked control files fail rather than loading outside rules', (t) => {
  const root = temporary(t),
    outside = temporary(t);
  put(outside, 'rules', '*.ts');
  try {
    symlinkSync(join(outside, 'rules'), join(root, '.gitignore'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Host does not permit file symlinks');
      return;
    }
    throw error;
  }
  fail(root, 'control_unreadable');
});

test(
  'special FIFO is recorded without blocking',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = temporary(t);
    const result = spawnSync('mkfifo', [join(root, 'pipe')]);
    assert.equal(result.status, 0);
    assert.equal(reason(root)['pipe'], 'special_file');
  },
);
test(
  'nonportable and case-colliding names fail explicitly',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = temporary(t);
    put(root, 'bad:name.txt', 'text');
    fail(root, 'unsupported_path');
    rmSync(join(root, 'bad:name.txt'));
    put(root, 'A.ts', 'export const a=1;');
    put(root, 'a.ts', 'export const a=1;');
    fail(root, 'path_collision');
  },
);
test(
  'non-UTF-8 filename fails rather than merging replacement characters',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = temporary(t);
    writeFileSync(
      Buffer.concat([Buffer.from(root + '/'), Buffer.from([0xff])]),
      'text',
    );
    assert.throws(() => scanRepository(root));
  },
);

test(
  'denied files and directories are partial, denied selection controls abort',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), 'shcontext permission '));
    t.after(() => {
      for (const [path, mode] of [
        ['denied.txt', 0o644],
        ['locked', 0o755],
        ['.gitignore', 0o644],
      ])
        if (existsSync(join(root, path))) chmodSync(join(root, path), mode);
      rmSync(root, { recursive: true, force: true });
    });
    chmodSync(root, 0o755);
    put(root, 'denied.txt', 'private');
    put(root, 'locked/a.txt', 'private');
    chmodSync(join(root, 'denied.txt'), 0);
    chmodSync(join(root, 'locked'), 0);
    const identity = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
    let result = spawnSync(process.execPath, [cli, 'scan', root], {
      encoding: 'utf8',
      ...identity,
      timeout: 20000,
    });
    if (
      result.error &&
      identity.uid !== undefined &&
      ['EINVAL', 'EPERM'].includes(result.error.code)
    ) {
      t.skip('Host cannot spawn an unprivileged permission-test process');
      return;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 2, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(
      data.entries.find((e) => e.path === 'denied.txt').reason,
      'permission_denied',
    );
    assert.equal(
      data.entries.find((e) => e.path === 'locked/').reason,
      'directory_unreadable',
    );
    assert.ok(!data.entries.some((e) => e.path === 'locked/a.txt'));
    put(root, '.gitignore', '*');
    chmodSync(join(root, '.gitignore'), 0);
    result = spawnSync(process.execPath, [cli, 'scan', root], {
      encoding: 'utf8',
      ...identity,
      timeout: 20000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /control_unreadable/);
  },
);

test('empty directories and nested context names remain in scope', (t) => {
  const root = temporary(t);
  assert.deepEqual(
    scanRepository(root).inventory.entries.map((e) => e.path),
    ['.'],
  );
  mkdirSync(join(root, 'empty'));
  put(root, 'src/context/README.md', '# Source context');
  const data = reason(root);
  assert.equal(data['empty/'], 'directory_enumerated');
  assert.equal(data['src/context/README.md'], 'supported_text');
  assert.equal(scanRepository(root).inventory.coverage, 'complete');
});

test('Git tracking ignores inherited index/worktree overrides and fsmonitor commands', (t) => {
  const root = temporary(t);
  git(root, 'init');
  put(root, 'tracked.ts', 'export const a=1;');
  git(root, 'add', 'tracked.ts');
  put(root, '.gitignore', '*.ts');
  git(root, 'config', 'core.fsmonitor', 'this-command-must-not-run');
  const result = spawnSync(process.execPath, [cli, 'scan', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_DIR: '/invalid',
      GIT_WORK_TREE: '/invalid',
      GIT_INDEX_FILE: '/invalid',
    },
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).entries.find((e) => e.path === 'tracked.ts')
      .reason,
    'supported_source',
  );
});
