import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { buildRepository, verifyRepository } from '../../dist/index.js';
import { fixture as rawFixture, fakeProvider, put } from './generation.mjs';
export { fakeProvider, put };
export function fixture(t, options) {
  return fs.realpathSync(rawFixture(t, options));
}
export const hash = (bytes) =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');
export const readManifest = (root) =>
  JSON.parse(
    fs.readFileSync(join(root, 'context/.shcontext/manifest.json'), 'utf8'),
  );
export function saveManifest(root, manifest) {
  put(
    root,
    'context/.shcontext/manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
}
export function editOutput(root, path, edit) {
  const content = edit(fs.readFileSync(join(root, path), 'utf8'));
  put(root, path, content);
  const manifest = readManifest(root);
  manifest.outputs.find((output) => output.path === path).sha256 =
    hash(content);
  saveManifest(root, manifest);
}
export async function built(t, options) {
  const root = fixture(t, options);
  const result = await buildRepository(root, { provider: fakeProvider() });
  return { root, ...result };
}
export function snapshot(root) {
  const files = {};
  function walk(path, rel = '') {
    for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files[name + '/'] = 'directory';
        walk(join(path, entry.name), name);
      } else if (entry.isSymbolicLink())
        files[name] = fs.readlinkSync(join(path, entry.name));
      else files[name] = hash(fs.readFileSync(join(path, entry.name)));
    }
  }
  walk(root);
  return files;
}
export function denyRead(t, path) {
  const original = fs.openSync;
  const mock = t.mock.method(fs, 'openSync', function (file, ...args) {
    if (String(file) === path) {
      const error = Error('denied');
      error.code = 'EACCES';
      throw error;
    }
    return original.call(this, file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
}
export function verified(root) {
  return verifyRepository(root);
}

/** Exercise the pre-cache v1 format independently of cache/Markdown consistency. */
export function legacyOutput(root) {
  const manifest = readManifest(root);
  manifest.outputs = manifest.outputs.filter(
    (item) => item.path !== 'context/.shcontext/cache.json',
  );
  fs.rmSync(join(root, 'context/.shcontext/cache.json'));
  saveManifest(root, manifest);
}
