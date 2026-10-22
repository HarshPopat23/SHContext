import {
  constants,
  lstatSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { ScanError } from './errors.js';

export function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  return ['EACCES', 'EPERM', 'ENOENT', 'EIO', 'ELOOP', 'ENOTDIR'].includes(
    code ?? '',
  )
    ? code!
    : 'READ_FAILED';
}
export function digest(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
export function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}
/** Recheck every ancestor rather than following a directory symlink. */
export function assertContained(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep))
    throw new ScanError('outside_root', 'Path is outside the selected root.');
  let current = root;
  const parts = rel ? rel.split(sep) : [];
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new ScanError('source_changed', 'A source path became a symlink.');
  }
  if (realpathSync(path) !== path)
    throw new ScanError('source_changed', 'Source path identity changed.');
}
export function readBounded(
  root: string,
  path: string,
  limit: number,
): { bytes: Buffer; oversized: boolean } {
  assertContained(root, dirname(path));
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new ScanError('source_changed', 'Expected a regular source file.');
  const fd = openSync(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new ScanError('source_changed', 'Source file identity changed.');
    if (opened.size > limit) return { bytes: Buffer.alloc(0), oversized: true };
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      const chunk = Buffer.alloc(Math.min(65536, limit - total + 1));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(fd);
    assertContained(root, path);
    const current = lstatSync(path);
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev
    )
      throw new ScanError(
        'source_changed',
        'Source file changed while reading.',
      );
    return { bytes: Buffer.concat(chunks), oversized: total > limit };
  } finally {
    closeSync(fd);
  }
}
export function decode(bytes: Buffer, preserveBOM = false): string {
  return new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: preserveBOM,
  }).decode(bytes);
}
