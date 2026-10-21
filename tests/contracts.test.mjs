import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SCHEMA_VERSION,
  contractSchemas,
  validateContract,
  FilePathSchema,
  FolderPathSchema,
  HashSchema,
  EffectiveConfigSchema,
} from '../dist/core/contracts/index.js';

function example(name) {
  return JSON.parse(
    readFileSync(
      new URL(`../docs/examples/contracts/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
}
const complete = example('complete-bundle');
const partial = example('partial-bundle');
const verification = example('verification-result');
const records = {
  repositoryInventory: complete.inventory,
  fileAnalysis: complete.analyses[0],
  dependencyEdge: complete.edges[0],
  folderSummary: complete.folders[1],
  generationManifest: complete.manifest,
  validationFinding: verification.findings[0],
  verificationResult: verification,
  bundle: complete,
};

function rejects(name, value, code) {
  const result = validateContract(name, value);
  assert.equal(result.success, false);
  assert.ok(result.findings.length > 0);
  for (const finding of result.findings)
    assert.equal(
      contractSchemas.validationFinding.safeParse(finding).success,
      true,
    );
  if (code)
    assert.ok(
      result.findings.some((finding) => finding.code === code),
      JSON.stringify(result.findings),
    );
}

for (const [name, record] of Object.entries(records)) {
  test(`${name}: validates and round-trips the documented record`, () => {
    const result = validateContract(name, record);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.deepEqual(result.data, JSON.parse(JSON.stringify(record)));
  });
  test(`${name}: rejects future versions and extra fields`, () => {
    rejects(
      name,
      { ...record, schema_version: SCHEMA_VERSION + 1 },
      'schema_violation',
    );
    rejects(
      name,
      { ...record, access_token: 'DO_NOT_ECHO_TEST_VALUE' },
      'schema_violation',
    );
  });
}

test('partial bundle preserves unsupported content without invented syntax facts', () => {
  const result = validateContract('bundle', partial);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(
    result.data.manifest.analysis_failures[0].code,
    'unsupported_language',
  );
  assert.equal(result.data.folders[0].coverage, 'partial');
});

test('complete example source hashes match the actual repository fixture bytes', () => {
  for (const analysis of complete.analyses) {
    const bytes = readFileSync(
      new URL(`./fixtures/simple-repository/${analysis.path}`, import.meta.url),
    );
    assert.equal(
      analysis.sha256,
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
});

test('portable source paths reject escape, reserved roots, URLs and control characters', () => {
  for (const path of [
    '/etc/passwd',
    '../a.ts',
    'src/../a.ts',
    'src//a.ts',
    './src/a.ts',
    'C:/a.ts',
    'src\\a.ts',
    'https://example.com/a.ts',
    'context/a.ts',
    '.shcontext/a.ts',
    'src/CONTEXT.md/a.ts',
    'src/\u0000a.ts',
    'src/a.ts/',
    'src/\ud800.ts',
  ])
    assert.equal(FilePathSchema.safeParse(path).success, false, path);
  for (const path of [
    'src/a.ts',
    'src/my file.ts',
    'src/日本語.ts',
    'src/café.ts',
  ])
    assert.equal(FilePathSchema.parse(path), path);
  assert.equal(FolderPathSchema.safeParse('src/CONTEXT.md').success, false);
  assert.equal(FolderPathSchema.parse('.'), '.');
});

test('hashes require the algorithm prefix, exact length and lowercase hex', () => {
  for (const value of [
    'a'.repeat(64),
    `sha256:${'A'.repeat(64)}`,
    `sha256:${'f'.repeat(63)}`,
    `sha1:${'f'.repeat(64)}`,
  ])
    assert.equal(HashSchema.safeParse(value).success, false);
});

test('required null and missing data are different; numbers are not coerced', () => {
  const record = structuredClone(complete.manifest);
  delete record.provenance;
  rejects('generationManifest', record, 'schema_violation');
  const config = structuredClone(record.selection.configuration);
  config.maxEntries = '10000';
  assert.equal(EffectiveConfigSchema.safeParse(config).success, false);
  config.maxEntries = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(EffectiveConfigSchema.safeParse(config).success, false);
});

const negativeBundles = [
  [
    'counts cannot claim undiscovered files',
    (b) => b.inventory.counts.files.analyzed++,
    'invalid_inventory',
  ],
  [
    'root inventory cannot be omitted',
    (b) => {
      b.inventory.entries.shift();
      b.inventory.counts.directories.analyzed--;
    },
    'invalid_inventory',
  ],
  [
    'pruned directories cannot contain observed descendants',
    (b) => {
      const entry = b.inventory.entries[1];
      entry.disposition = 'ignored';
      entry.reason = 'gitignore';
      b.inventory.counts.directories.analyzed--;
      b.inventory.counts.directories.ignored++;
    },
    'invalid_inventory',
  ],
  [
    'inventory identities must be unique',
    (b) => {
      b.inventory.entries.push(structuredClone(b.inventory.entries[3]));
      b.inventory.counts.files.analyzed++;
    },
    'duplicate_identity',
  ],
  [
    'path collections must use byte ordering',
    (b) => b.inventory.entries.reverse(),
    'invalid_order',
  ],
  [
    'symbol ranges stay within the recorded file',
    (b) => (b.analyses[0].symbols[0].range.end_line = 99),
    'invalid_analysis',
  ],
  [
    'failed parsers cannot retain symbols',
    (b) => {
      b.analyses[0].disposition = 'parse-error';
      b.analyses[0].diagnostics = [
        { code: 'syntax_error', message: 'Fixture syntax failure.' },
      ];
    },
    'invalid_analysis',
  ],
  [
    'only supported languages have structural mode',
    (b) => (b.analyses[0].language = 'python'),
    'invalid_analysis',
  ],
  [
    'reference bytes stay within the source inventory size',
    (b) => {
      b.analyses[1].references[0].end_byte = 99999;
      b.edges[0].reference.end_byte = 99999;
    },
    'inconsistent_bundle',
  ],
  [
    'computed references cannot invent a resolved target',
    (b) => {
      b.edges[0].reference.specifier = null;
    },
    'invalid_dependency',
  ],
  [
    'unresolved references must not carry a target',
    (b) => {
      b.edges[0].resolution = 'unresolved';
      b.edges[0].reason = 'missing_target';
    },
    'schema_violation',
  ],
  [
    'resolved targets must exist in inventory',
    (b) => (b.edges[0].to = 'src/missing.ts'),
    'inconsistent_bundle',
  ],
  [
    'graph cannot omit observed references',
    (b) => (b.edges.length = 0),
    'inconsistent_bundle',
  ],
  [
    'evidence IDs must resolve',
    (b) => (b.folders[1].purpose[0].evidence_ids = ['E999']),
    'invalid_evidence',
  ],
  [
    'evidence hashes must match the source',
    (b) => (b.folders[1].evidence[0].sha256 = `sha256:${'0'.repeat(64)}`),
    'inconsistent_bundle',
  ],
  [
    'evidence ranges stay within analyzed lines',
    (b) => (b.folders[1].evidence[0].end_line = 999),
    'inconsistent_bundle',
  ],
  [
    'inferences need an explicit rationale',
    (b) => {
      b.folders[1].purpose[0].kind = 'inference';
    },
    'schema_violation',
  ],
  [
    'folder coverage cannot omit an included directory',
    (b) => b.folders.pop(),
    'inconsistent_bundle',
  ],
  [
    'folder files cannot omit an observed direct file',
    (b) => b.folders[1].files.pop(),
    'inconsistent_bundle',
  ],
  [
    'parent navigation must cover child folders',
    (b) => (b.folders[0].children.length = 0),
    'inconsistent_bundle',
  ],
  [
    'manifest identities must match inventory',
    (b) => (b.manifest.files[0].sha256 = `sha256:${'0'.repeat(64)}`),
    'inconsistent_bundle',
  ],
  [
    'snapshot identity must agree across modules',
    (b) => (b.folders[1].input_id = `sha256:${'0'.repeat(64)}`),
    'inconsistent_bundle',
  ],
  [
    'parser/generator version records cannot disagree',
    (b) => (b.manifest.generation.generator = 'different-version'),
    'invalid_manifest',
  ],
  [
    'provider configuration cannot include credentials',
    (b) =>
      (b.manifest.selection.configuration.provider.api_key =
        'DO_NOT_ECHO_TEST_VALUE'),
    'schema_violation',
  ],
  [
    'manifest cannot hash itself',
    (b) => (b.manifest.outputs[0].path = 'context/.shcontext/manifest.json'),
    'schema_violation',
  ],
  [
    'every context output must be owned',
    (b) => b.manifest.outputs.pop(),
    'invalid_manifest',
  ],
  [
    'absent root selection controls still need explicit identities',
    (b) => b.manifest.selection.control_files.shift(),
    'invalid_manifest',
  ],
];
for (const [description, change, code] of negativeBundles)
  test(description, () => {
    const bundle = structuredClone(complete);
    change(bundle);
    rejects('bundle', bundle, code);
  });

test('partial failures cannot disappear from the manifest', () => {
  const bundle = structuredClone(partial);
  bundle.manifest.analysis_failures = [];
  rejects('bundle', bundle, 'invalid_manifest');
});

test('unsupported content cannot support a behavioral explanation', () => {
  const bundle = structuredClone(partial);
  bundle.folders[1].evidence[0].path = 'src/legacy.py';
  bundle.folders[1].evidence[0].sha256 = bundle.analyses[2].sha256;
  rejects('bundle', bundle, 'inconsistent_bundle');
});

test('manifest output paths reject case collisions', () => {
  const manifest = structuredClone(complete.manifest);
  manifest.directories.splice(1, 0, { path: 'Src', coverage: 'complete' });
  manifest.outputs.splice(2, 0, {
    path: 'context/Src/CONTEXT.md',
    sha256: manifest.outputs[0].sha256,
  });
  rejects('generationManifest', manifest, 'duplicate_identity');
});

test('fresh and partial are independent, but fresh cannot contain errors', () => {
  const result = {
    schema_version: 1,
    state: 'fresh',
    coverage: 'partial',
    findings: [],
  };
  assert.equal(validateContract('verificationResult', result).success, true);
  result.findings = verification.findings;
  rejects('verificationResult', result, 'schema_violation');
});

test('safe findings never echo submitted values, even from unknown contracts', () => {
  const sentinel = 'DO_NOT_ECHO_TEST_VALUE';
  const result = validateContract('fileAnalysis', {
    ...complete.analyses[0],
    api_key: sentinel,
  });
  assert.equal(result.success, false);
  assert.ok(!JSON.stringify(result).includes(sentinel));
  rejects('toString', {}, 'unknown_contract');
});

test('well-linked but false prose is not certified by contract validation', () => {
  const bundle = structuredClone(complete);
  bundle.folders[1].purpose[0].text =
    'This module implements interplanetary payments.';
  assert.equal(validateContract('bundle', bundle).success, true);
});

test('folder counts must describe that folder subtree', () => {
  const bundle = structuredClone(complete);
  bundle.folders[1].counts.files.analyzed = 99;
  rejects('bundle', bundle, 'inconsistent_bundle');
});

test('inventory cannot claim the same source name is both a file and directory', () => {
  const inventory = structuredClone(complete.inventory);
  inventory.entries.splice(1, 0, {
    ...structuredClone(inventory.entries[2]),
    path: 'src',
  });
  inventory.counts.files.analyzed++;
  rejects('repositoryInventory', inventory, 'duplicate_identity');
});

test('a source over its configured file limit cannot claim completed analysis', () => {
  const bundle = structuredClone(complete);
  bundle.manifest.selection.configuration.maxFileBytes = 1;
  rejects('bundle', bundle, 'inconsistent_bundle');
});

test('an unreadable directory has a partial placeholder, not invented descendants', () => {
  const b = structuredClone(complete);
  const zero = {
    analyzed: 0,
    'inventory-only': 0,
    ignored: 0,
    skipped: 0,
    unreadable: 0,
    'parse-error': 0,
  };
  const message = 'Directory could not be enumerated.';
  b.inventory.entries.splice(1, 0, {
    path: 'blocked/',
    kind: 'directory',
    disposition: 'unreadable',
    reason: 'directory_unreadable',
    mode: 'none',
    bytes: null,
    sha256: null,
    diagnostics: [{ code: 'directory_unreadable', message }],
  });
  b.inventory.coverage =
    b.manifest.coverage =
    b.folders[0].coverage =
      'partial';
  b.inventory.counts.directories.unreadable++;
  b.folders[0].counts.directories.unreadable++;
  b.folders[0].limitations = [message];
  b.folders[0].children.unshift({ path: 'blocked', coverage: 'partial' });
  b.folders.splice(1, 0, {
    ...structuredClone(complete.folders[0]),
    source_path: 'blocked',
    coverage: 'partial',
    children: [],
    limitations: [message],
    counts: { files: { ...zero }, directories: { ...zero, unreadable: 1 } },
  });
  b.manifest.directories[0].coverage = 'partial';
  b.manifest.directories.splice(1, 0, { path: 'blocked', coverage: 'partial' });
  b.manifest.outputs.push({
    path: 'context/blocked/CONTEXT.md',
    sha256: b.manifest.outputs[0].sha256,
  });
  b.manifest.outputs.sort((a, c) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(c.path)),
  );
  b.manifest.analysis_failures = [
    { path: 'blocked/', code: 'directory_unreadable', message },
  ];
  const result = validateContract('bundle', b);
  assert.equal(result.success, true, JSON.stringify(result));
});

test('a parser failure can remain explicitly partial without symbol or behavior claims', () => {
  const b = structuredClone(complete);
  const message = 'Syntax could not be analyzed.';
  b.inventory.entries[2].disposition =
    b.analyses[0].disposition =
    b.manifest.files[0].disposition =
    b.folders[1].files[0].disposition =
      'parse-error';
  b.inventory.entries[2].reason = b.manifest.files[0].reason = 'syntax_error';
  b.inventory.entries[2].diagnostics = b.analyses[0].diagnostics = [
    { code: 'syntax_error', message },
  ];
  b.analyses[0].symbols = [];
  b.inventory.coverage = b.manifest.coverage = 'partial';
  b.inventory.counts.files.analyzed--;
  b.inventory.counts.files['parse-error']++;
  for (const folder of b.folders) {
    folder.coverage = 'partial';
    folder.limitations = [message];
    folder.counts.files.analyzed--;
    folder.counts.files['parse-error']++;
  }
  b.folders[0].children[0].coverage = 'partial';
  b.folders[1].purpose = [];
  b.folders[1].files[0].claims = [];
  b.folders[1].files[0].limitations = [message];
  b.folders[1].evidence.shift();
  for (const directory of b.manifest.directories)
    directory.coverage = 'partial';
  b.manifest.analysis_failures = [
    { path: 'src/greet.ts', code: 'syntax_error', message },
  ];
  const result = validateContract('bundle', b);
  assert.equal(result.success, true, JSON.stringify(result));
});
