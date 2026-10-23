#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { verifyRepository } from '../dist/index.js';

export function freshnessExit(result, allowPartial = false) {
  if (result.state !== 'fresh') return 1;
  return result.coverage === 'complete' || allowPartial ? 0 : 2;
}
export function summaryFor(result) {
  // Only fixed status values and contract finding codes enter Markdown; raw paths remain JSON data.
  const state = ['fresh', 'stale', 'unknown', 'invalid'].includes(result.state)
    ? result.state
    : 'unknown';
  const coverage = result.coverage === 'complete' ? 'complete' : 'partial';
  const codes = [
    ...new Set(
      result.findings
        .map((x) => String(x.code))
        .filter((x) => /^[a-z0-9_]+$/.test(x)),
    ),
  ];
  return `## SHContext freshness\n\nState: **${state}**. Coverage: **${coverage}**.\n\nFindings: ${result.findings.length}. Codes: ${codes.join(', ') || 'none'}.\n\nSee the JSON report for affected paths and diagnostics. Mechanical freshness does not prove explanation accuracy.\n`;
}
export function checkFreshness(
  root,
  { allowPartial = false, summaryPath, reportPath } = {},
) {
  const result = verifyRepository(root);
  if (reportPath)
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
  if (summaryPath) fs.appendFileSync(summaryPath, summaryFor(result));
  return { result, exitCode: freshnessExit(result, allowPartial) };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        'allow-partial': { type: 'boolean' },
        report: { type: 'string' },
      },
      allowPositionals: true,
    });
    if (positionals.length !== 1) throw Error('Expected one repository path.');
    const checked = checkFreshness(positionals[0], {
      allowPartial: values['allow-partial'] ?? false,
      reportPath: values.report,
      summaryPath: process.env.GITHUB_STEP_SUMMARY,
    });
    console.log(JSON.stringify(checked.result, null, 2));
    process.exitCode = checked.exitCode;
  } catch {
    console.error(
      'SHContext freshness inspection failed; check the repository, tool installation and report destinations.',
    );
    process.exitCode = 1;
  }
}
