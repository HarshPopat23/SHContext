import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
  readFileSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractJavaScript } from '../../dist/parsers/javascript.js';
export const fixture = fileURLToPath(
  new URL('../fixtures/extraction/repository', import.meta.url),
);
export function temporary(t, copy = false) {
  const root = mkdtempSync(join(tmpdir(), 'shcontext extraction '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (copy) cpSync(fixture, root, { recursive: true });
  return root;
}
export function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
export function extract(text, path = 'source.ts') {
  return extractJavaScript(
    path,
    `sha256:${createHash('sha256').update(text).digest('hex')}`,
    text,
  );
}
export function snapshot(root) {
  const files = {};
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const p = path ? path + '/' + name : name,
        s = lstatSync(join(root, p));
      files[p] = s.isFile()
        ? {
            bytes: readFileSync(join(root, p)).toString('hex'),
            mtime: s.mtimeMs,
          }
        : s.isDirectory()
          ? 'directory'
          : 'link';
      if (s.isDirectory()) walk(p);
    }
  }
  walk();
  return files;
}
