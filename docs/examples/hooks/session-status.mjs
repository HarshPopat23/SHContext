#!/usr/bin/env node
// Claude Code SessionStart hook: prints which context folders can be trusted.
// Stdout from a SessionStart hook is added to the session context. Never fails the session.
import { spawnSync } from 'node:child_process';

const bin = process.env.SHCONTEXT_BIN ?? 'shcontext';
const args = process.env.SHCONTEXT_BIN_ARGS
  ? JSON.parse(process.env.SHCONTEXT_BIN_ARGS)
  : [];
const r = spawnSync(bin, [...args, 'status', process.cwd()], {
  encoding: 'utf8',
  timeout: 20000,
});
try {
  const s = JSON.parse(r.stdout);
  if (s.state === 'current')
    console.log(
      `SHContext: all ${s.counts.fresh} folder summaries match current source. Read context/<folder>/CONTEXT.md before working in a folder.`,
    );
  else if (s.state === 'stale') {
    const stale = s.folders
      .filter((f) => f.state === 'stale')
      .map((f) => f.path);
    console.log(
      `SHContext: ${s.counts.fresh} folders fresh, ${s.counts.stale} stale. Read source directly in: ${stale.slice(0, 15).join(', ')}${stale.length > 15 ? ', ...' : ''}${s.new_folders.length ? `. New folders without context: ${s.new_folders.slice(0, 10).join(', ')}` : ''}. Refresh with shcontext update.`,
    );
  } else console.log(`SHContext: context is ${s.state}. ${s.note}`);
} catch {
  // shcontext not installed or no context: stay silent.
}
