import fs from 'node:fs';
import { readJSON } from './evaluate.mjs';

const quality = readJSON(new URL('./results/quality.json', import.meta.url));
const real = readJSON(new URL('./results/real.json', import.meta.url));
const agents = readJSON(new URL('./agent-results.json', import.meta.url));
const rows = [quality.evaluation, ...real.repositories];
const success = (task) =>
  task.score.all_expected &&
  task.score.correct_abstention !== false &&
  task.relationship_labels_correct !== false;
let text = `# Recorded evaluation results\n\nThese are scripted-provider/source-navigation controls, not live-model quality or billing measurements. Reproduce with the commands in [the method](../../docs/benchmarks.md).\n\n| Dataset | Tasks | SHContext success@8 | Literal exploration | Flat folder | Reviewed supported / unsupported / unreviewed file claims |\n| --- | ---: | ---: | ---: | ---: | --- |\n`;
for (const row of rows) {
  text += `| ${row.id} | ${row.questions.length} | ${row.questions.filter((x) => success(x.shcontext)).length} | ${row.questions.filter((x) => success(x.literal_exploration)).length} | ${row.questions.filter((x) => success(x.flat_folder)).length} | ${row.claims.supported} / ${row.claims.unsupported} / ${row.claims.unreviewed} |\n`;
}
text +=
  '\nSuccess means required-file coverage, declared relationship-label checks and correct no-match abstention for that task. It is not natural-language answer accuracy. Required-file precision/recall, references and individual misses are in [quality.json](quality.json) and [real.json](real.json).\n\n';
text += `Controlled updates: **${quality.updates.filter((x) => x.correct).length}/${quality.updates.length}** scenarios matched their exact expected folder set, retained reused prose and ended fresh. Unchanged update calls: **${quality.updates.find((x) => x.name === 'unchanged').metrics.requests}**; flat baseline: **${quality.updates.find((x) => x.name === 'unchanged').flat_regeneration.requests}**.\n\n`;
text += `The false-claim control remained mechanically fresh but had **${quality.negative_control.claims.unsupported}** pre-reviewed unsupported claim. No general false-explanation detection is established.\n\n`;
text +=
  '| Dataset | SHContext generation ms | Flat generation ms | SHContext scripted requests | Flat scripted requests | Input / output token reservations | Illustrative reserved USD |\n| --- | ---: | ---: | ---: | ---: | --- | ---: |\n';
for (const row of rows)
  text += `| ${row.id} | ${row.generation.elapsed_ms.toFixed(2)} | ${row.flat_generation.elapsed_ms.toFixed(2)} | ${row.generation.requests} | ${row.flat_generation.requests} | ${row.generation.reserved_input_tokens} / ${row.generation.reserved_output_tokens} | ${row.generation.illustrative_reserved_cost_usd.toFixed(6)} |\n`;
text += `\nThose timings are single observations; order/cache and feature differences preclude a speed ranking. Rates are illustrative caller inputs ($1/input million, $2/output million), not model prices. Actual remote model cost is zero for these scripted runs; actual model tokens are unavailable/not applicable. Live quality, tokens and real-price measurement remain blocked.\n\nThe separate controlled worker experiment measured **${agents.speedup.toFixed(2)}×** speedup (${agents.sequential_median_ms.toFixed(2)} → ${agents.parallel_median_ms.toFixed(2)} ms), with identical output hashes, coverage and citations, and equal request counts. See [agent-results.json](../agent-results.json) for every trial and environment.\n\n`;
for (const row of real.repositories)
  text += `- ${row.id}: [${row.source.commit} ](${row.source.url.replace(/\.git$/, '')}/tree/${row.source.commit}), ${row.source.license}; tracked source remained unchanged and no repository code/tests were executed.\n`;
text += `\nEnvironment: Node ${quality.node}, ${quality.platform}. Generation identities and dataset/source SHA-256 bindings are in the JSON. Results from two tiny projects and a controlled fixture do not establish broad production advantage over ordinary exploration or live folder summaries.\n`;
const { format } = await import('prettier');
fs.writeFileSync(
  new URL('./results/README.md', import.meta.url),
  await format(text, { parser: 'markdown' }),
);
console.log('EVALUATION REPORT WRITTEN');
