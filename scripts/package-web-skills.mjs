import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const positional = args.filter((x) => x !== '--require-clean');
assert.equal(
  positional.length,
  1,
  'Usage: node scripts/package-web-skills.mjs <new-output-directory> [--require-clean]',
);
const out = resolve(positional[0]);
const rel = relative(root, out);
assert.ok(
  rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel),
  'Package outside the source checkout.',
);
assert.ok(!fs.existsSync(out), 'Output exists; choose a new directory.');
function run(command, argv) {
  const result = spawnSync(command, argv, {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const revision = run('git', ['rev-parse', 'HEAD']);
const dirty = run('git', ['status', '--porcelain']).length > 0;
if (args.includes('--require-clean'))
  assert.equal(dirty, false, 'Refusing a dirty checkout.');
const python = process.platform === 'win32' ? 'python' : 'python3';
run(python, [
  '-c',
  'import sys; assert sys.version_info >= (3, 9), "Python 3.9+ required"',
]);
const metadata = JSON.parse(fs.readFileSync(join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(join(root, 'package-lock.json')));
assert.equal(lock.lockfileVersion, 3);
fs.mkdirSync(dirname(out), { recursive: true });
fs.mkdirSync(out);
const staging = fs.mkdtempSync(join(out, '.staging-'));
try {
  const runtime = join(staging, 'runtime');
  fs.mkdirSync(runtime);
  // Compile directly into the bundle: no dependence on stale dist/ or a consumer install.
  run(process.execPath, [
    join(root, 'node_modules/typescript/bin/tsc'),
    '--project',
    'tsconfig.build.json',
    '--outDir',
    join(runtime, 'dist'),
  ]);
  fs.writeFileSync(
    join(runtime, 'package.json'),
    JSON.stringify(
      {
        name: 'shcontext-web-runtime',
        version: metadata.version,
        type: 'module',
        license: metadata.license,
        engines: metadata.engines,
        dependencies: metadata.dependencies,
      },
      null,
      2,
    ) + '\n',
  );
  fs.copyFileSync(join(root, 'LICENSE'), join(runtime, 'LICENSE'));
  const dependencies = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/') || entry.dev) continue;
    assert.ok(
      !entry.link && !path.split('/').includes('..'),
      'Only locked production packages may be bundled.',
    );
    const source = join(root, path);
    const installed = JSON.parse(fs.readFileSync(join(source, 'package.json')));
    assert.equal(
      installed.version,
      entry.version,
      `Installed version differs from lock: ${path}`,
    );
    fs.mkdirSync(dirname(join(runtime, path)), { recursive: true });
    fs.cpSync(source, join(runtime, path), {
      recursive: true,
      dereference: false,
      filter: (file) => !fs.lstatSync(file).isSymbolicLink(),
    });
    dependencies.push({
      path,
      version: entry.version,
      integrity: entry.integrity,
      license: entry.license ?? installed.license,
    });
  }
  fs.writeFileSync(
    join(runtime, 'BUNDLE.json'),
    JSON.stringify({ version: 1, revision, dirty, dependencies }, null, 2) +
      '\n',
  );
  const artifacts = [];
  for (const operation of ['build', 'update', 'verify', 'query']) {
    const name = `context-web-${operation}`;
    const skill = join(staging, name);
    fs.cpSync(join(root, 'skills-web', name), skill, { recursive: true });
    const resources = join(skill, 'resources');
    fs.mkdirSync(resources);
    fs.cpSync(runtime, join(resources, 'runtime'), { recursive: true });
    fs.copyFileSync(
      join(root, 'scripts/web-workspace.py'),
      join(resources, 'web.py'),
    );
    fs.copyFileSync(
      join(root, 'skills-web/shared/workflow.md'),
      join(skill, 'references/workflow.md'),
    );
    const target = join(out, name + '.zip');
    run(python, [
      '-c',
      `import pathlib,stat,sys,zipfile
source=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(source.rglob('*')):
  if p.is_symlink(): raise ValueError('Linked bundle resource')
  if p.is_file():
   info=zipfile.ZipInfo(source.name+'/'+p.relative_to(source).as_posix(),(1980,1,1,0,0,0))
   info.external_attr=(stat.S_IFREG|0o644)<<16; info.compress_type=zipfile.ZIP_DEFLATED
   z.writestr(info,p.read_bytes(),compresslevel=9)`,
      skill,
      target,
    ]);
    artifacts.push({
      file: name + '.zip',
      bytes: fs.statSync(target).size,
      sha256: createHash('sha256')
        .update(fs.readFileSync(target))
        .digest('hex'),
    });
  }
  fs.writeFileSync(
    join(out, 'web-distribution.json'),
    JSON.stringify(
      {
        version: 1,
        revision,
        dirty,
        runtime: metadata.engines.node,
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    join(out, 'SHA256SUMS'),
    artifacts.map((x) => `${x.sha256}  ${x.file}\n`).join(''),
  );
  console.log(
    JSON.stringify({ status: 'packaged', output: out, artifacts }, null, 2),
  );
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
