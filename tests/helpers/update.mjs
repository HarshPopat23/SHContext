import fs from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  buildRepository,
  updateRepository,
  verifyRepository,
} from '../../dist/index.js';
import {
  fixture,
  fakeProvider,
  put,
  readManifest,
  saveManifest,
  hash,
} from './verification.mjs';
import { generationId } from '../../dist/generation/summarize.js';
import { renderFolder } from '../../dist/generation/render.js';
export { fixture, fakeProvider, put, updateRepository, verifyRepository };
export async function baseline(t, options) {
  const root = fixture(t, options);
  put(root, 'unrelated/info.ts', 'export const info = 1;\n');
  const result = await buildRepository(root, { provider: fakeProvider() });
  return { root, ...result };
}
export const paths = (provider) =>
  provider.calls.map((call) => call.input.source_path).sort();
export function allPaths(bundle) {
  return bundle.folders.map((folder) => folder.source_path).sort();
}
export async function changed(root, expected) {
  const provider = fakeProvider();
  const result = await updateRepository(root, { provider });
  assert.equal(result.changed, true);
  assert.deepEqual(paths(provider), [...expected].sort());
  assert.equal(result.model_calls, provider.calls.length);
  assert.equal(verifyRepository(root).state, 'fresh');
  return result;
}
export function rewriteCache(root, edit) {
  const path = 'context/.shcontext/cache.json';
  const cache = JSON.parse(fs.readFileSync(join(root, path), 'utf8'));
  edit(cache);
  const content = JSON.stringify(cache, null, 2) + '\n';
  put(root, path, content);
  const manifest = readManifest(root);
  manifest.outputs.find((item) => item.path === path).sha256 = hash(content);
  saveManifest(root, manifest);
}
export function olderComponent(root, field) {
  const manifest = readManifest(root);
  manifest.generation[field] += '-old';
  if (field === 'generator')
    manifest.generator.version = manifest.generation.generator;
  const id = generationId(manifest.generation);
  manifest.generator.generation_id = id;
  const path = 'context/.shcontext/cache.json';
  const cache = JSON.parse(fs.readFileSync(join(root, path), 'utf8'));
  cache.generation_id = id;
  for (const item of cache.folders) {
    item.summary.generation_id = id;
    const output =
      item.summary.source_path === '.'
        ? 'context/CONTEXT.md'
        : `context/${item.summary.source_path}/CONTEXT.md`;
    put(root, output, renderFolder(item.summary));
  }
  put(root, path, JSON.stringify(cache, null, 2) + '\n');
  for (const output of manifest.outputs)
    output.sha256 = hash(fs.readFileSync(join(root, output.path)));
  saveManifest(root, manifest);
}
