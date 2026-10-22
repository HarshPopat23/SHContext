import type { SourceSpan } from '../core/contracts/index.js';
/** Babel offsets are UTF-16. Portable reference offsets are raw UTF-8 bytes. */
export function locations(path: string, sha256: string, text: string) {
  const bytes = new Uint32Array(text.length + 1),
    lines = [0];
  let offset = 0,
    byte = 0;
  for (const character of text) {
    bytes[offset] = byte;
    if (character.length === 2) bytes[offset + 1] = byte;
    offset += character.length;
    byte += Buffer.byteLength(character);
  }
  bytes[offset] = byte;
  for (const match of text.matchAll(/\r\n|[\n\r\u2028\u2029]/g))
    lines.push(match.index + match[0].length);
  const line = (position: number) => {
    let low = 0,
      high = lines.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (lines[mid]! <= position) low = mid;
      else high = mid;
    }
    return low + 1;
  };
  return {
    line_count: text.length === 0 ? 0 : lines.length,
    byte: (index: number) => bytes[index]!,
    span: (
      start: number,
      end: number,
      basis: SourceSpan['basis'] = 'source',
    ): SourceSpan => ({
      path,
      sha256,
      start_line: line(start),
      end_line: line(Math.max(start, end - 1)),
      symbol: null,
      basis,
    }),
  };
}
