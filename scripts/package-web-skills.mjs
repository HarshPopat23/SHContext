import assert from 'node:assert/strict';
import { build } from 'esbuild';
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
  // Produce plain JavaScript resources: Claude rejects >200 files and nested ZIPs.
  // Babel's explicit createRequire call needs a bundler-visible literal require.
  await build({
    entryPoints: {
      'web/runtime': join(root, 'src/web/runtime.ts'),
      index: join(root, 'src/index.ts'),
    },
    outdir: join(runtime, 'dist'),
    bundle: true,
    platform: 'node',
    target: 'node22.14',
    format: 'esm',
    mainFields: ['module', 'main'],
    banner: {
      js: "import { createRequire as __webCreateRequire } from 'node:module'; const require = __webCreateRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'babel-traverse-literal',
        setup(builder) {
          builder.onLoad(
            { filter: /[/\\]parsers[/\\]javascript\.ts$/ },
            ({ path }) => {
              const source = fs.readFileSync(path, 'utf8');
              const expression =
                "createRequire(import.meta.url)('@babel/traverse')";
              assert.ok(
                source.includes(expression),
                'Review Babel traversal bundling after parser changes.',
              );
              return {
                contents: source.replace(
                  expression,
                  "require('@babel/traverse')",
                ),
                loader: 'ts',
              };
            },
          );
        },
      },
    ],
  });
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
    // Retain every production package's license separately from the bundled code.
    const licenses = fs
      .readdirSync(source)
      .filter((name) =>
        /^(?:licen[sc]e|copying|notice)(?:[.\-]|$)/i.test(name),
      );
    assert.ok(licenses.length, `Missing license: ${path}`);
    const licenseRoot = join(
      runtime,
      'licenses',
      path.slice('node_modules/'.length).replaceAll('@', ''),
    );
    fs.mkdirSync(licenseRoot, { recursive: true });
    for (const name of licenses)
      fs.copyFileSync(join(source, name), join(licenseRoot, name));
    dependencies.push({
      path,
      version: entry.version,
      integrity: entry.integrity,
      license: entry.license ?? installed.license,
    });
  }
  fs.writeFileSync(
    join(runtime, 'BUNDLE.json'),
    JSON.stringify(
      {
        version: 1,
        revision,
        dirty,
        bundler: {
          name: 'esbuild',
          version: lock.packages['node_modules/esbuild'].version,
        },
        dependencies,
      },
      null,
      2,
    ) + '\n',
  );
  const artifacts = [];
  for (const operation of ['build', 'update', 'verify', 'query']) {
    const name = `context-web-${operation}`;
    const skill = join(staging, name);
    fs.cpSync(join(root, 'skills-web', name), skill, { recursive: true });
    const resources = join(skill, 'resources');
    fs.mkdirSync(resources);
    fs.cpSync(runtime, join(resources, 'runtime'), { recursive: true });
    fs.mkdirSync(join(skill, 'references'), { recursive: true });
    fs.copyFileSync(
      join(root, 'scripts/web-workspace.py'),
      join(resources, 'web.py'),
    );
    fs.copyFileSync(
      join(root, 'skills-web/shared/workflow.md'),
      join(skill, 'references/workflow.md'),
    );
    const count = (directory) =>
      fs
        .readdirSync(directory, { withFileTypes: true })
        .reduce(
          (n, entry) =>
            n + (entry.isDirectory() ? count(join(directory, entry.name)) : 1),
          0,
        );
    assert.ok(count(skill) <= 200, 'Claude skills allow at most 200 files.');
    const target = join(out, name + '.zip');
    run(python, [
      '-c',
      `import pathlib,stat,sys,zipfile
source=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(source.rglob('*')):
  if p.is_symlink(): raise ValueError('Linked bundle resource')
  if p.is_file():
   name=source.name+'/'+p.relative_to(source).as_posix()
   assert all(c.isascii() and (c.isalnum() or c in '_./-') for c in name), 'Nonportable skill resource path'
   info=zipfile.ZipInfo(name,(1980,1,1,0,0,0))
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
