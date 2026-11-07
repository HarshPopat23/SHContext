// Stand-in agent: answers with the files visible in cwd and mimics claude's JSON.
import fs from 'node:fs';
const prompt = process.argv.at(-1);
const hasContext = fs.existsSync('context/CONTEXT.md');
const result = `prompt=${prompt}; context=${hasContext}; agents=${fs.existsSync('AGENTS.md')}; mcp=${fs.existsSync('.mcp.json')}`;
console.log(JSON.stringify({ result, is_error: false, total_cost_usd: hasContext ? 0.05 : 0.1, duration_ms: 10, num_turns: 2, usage: { input_tokens: hasContext ? 100 : 400, output_tokens: 50 } }));
