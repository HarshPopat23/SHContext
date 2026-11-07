import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { analyze } from './lib.mjs';

const { values } = parseArgs({
  options: {
    results: { type: 'string' },
    baseline: { type: 'string', default: 'none' },
    thresholds: { type: 'string' },
    overhead: { type: 'string' },
  },
});
if (!values.results) {
  console.error(
    'Usage: analyze.mjs --results results.jsonl [--baseline none] [--thresholds file.json] [--overhead file.json]',
  );
  process.exit(1);
}
const records = fs
  .readFileSync(values.results, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const read = (f) => (f ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined);
console.log(
  JSON.stringify(
    analyze(records, {
      baseline: values.baseline,
      thresholds: read(values.thresholds),
      overhead: read(values.overhead) ?? {},
    }),
    null,
    2,
  ),
);
