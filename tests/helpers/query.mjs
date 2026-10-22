import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepository } from '../../dist/index.js';
import { fixture as base, put, fakeProvider } from './verification.mjs';
export { put };
export function fixture(t) {
  const root = base(t, { sources: false });
  fs.cpSync(
    fileURLToPath(new URL('../fixtures/query/repository', import.meta.url)),
    root,
    { recursive: true },
  );
  return root;
}
export async function built(t) {
  const root = fixture(t);
  await buildRepository(root, {
    provider: fakeProvider((draft, input) => {
      if (input.source_path === 'src/auth')
        draft.purpose[0].text =
          'Groups authentication session checks and a signature-prefix helper.';
      return draft;
    }),
  });
  return root;
}
