import { basename } from 'node:path';
import { parseTree, type Node, type ParseError } from 'jsonc-parser';
import type {
  ConfigurationRecord,
  EntryPoint,
} from '../core/contracts/index.js';
import { locations } from './locations.js';
export type EntryDeclaration = Omit<EntryPoint, 'resolution' | 'to' | 'reason'>;
const pointer = (parts: string[]) =>
  '/' +
  parts.map((s) => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
export function inspectConfiguration(
  path: string,
  sha256: string,
  text: string,
): { record: ConfigurationRecord; declarations: EntryDeclaration[] } | null {
  const name = basename(path),
    format =
      name === 'package.json'
        ? 'package-json'
        : /^(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i.test(name)
          ? 'typescript-jsonc'
          : null;
  if (format === null) return null;
  const record: ConfigurationRecord = {
      path,
      sha256,
      format,
      facts: [],
      diagnostics: [],
    },
    declarations: EntryDeclaration[] = [];
  const loc = locations(path, sha256, text),
    base = text.startsWith('\ufeff') ? 1 : 0;
  try {
    const errors: ParseError[] = [];
    const tree = parseTree(text.slice(base), errors, {
      disallowComments: format === 'package-json',
      allowTrailingComma: format === 'typescript-jsonc',
    });
    if (!tree || errors.length || tree.type !== 'object') throw new Error();
    function unique(n: Node): void {
      if (n.type === 'object') {
        const keys = n.children?.map((p) => p.children?.[0]?.value) ?? [];
        if (new Set(keys).size !== keys.length) throw new Error();
      }
      n.children?.forEach(unique);
    }
    unique(tree);
    const properties = (n: Node) =>
      n.type === 'object' ? (n.children ?? []) : [];
    const value = (property: Node) => property.children![1]!;
    const key = (property: Node) => String(property.children![0]!.value);
    const evidence = (node: Node) =>
      loc.span(
        base + node.offset,
        base + node.offset + node.length,
        'configuration',
      );
    const fact = (
      parts: string[],
      kind: ConfigurationRecord['facts'][number]['kind'],
      v: string | boolean | string[],
      node: Node,
    ) =>
      record.facts.push({
        pointer: pointer(parts),
        kind,
        value: v,
        evidence: evidence(node),
      });
    const strings = (node: Node): string[] =>
      node.type === 'string'
        ? [String(node.value)]
        : node.type === 'array'
          ? (node.children ?? [])
              .filter((n) => n.type === 'string')
              .map((n) => String(n.value))
          : [];
    function entry(
      node: Node,
      parts: string[],
      kind: EntryPoint['kind'],
    ): void {
      if (node.type === 'string') {
        declarations.push({
          kind,
          selector: pointer(parts),
          specifier: String(node.value),
          evidence: evidence(node),
        });
        return;
      }
      if (node.type === 'array') {
        node.children?.forEach((n, i) => entry(n, [...parts, String(i)], kind));
        return;
      }
      for (const prop of properties(node))
        entry(value(prop), [...parts, key(prop)], kind);
    }
    for (const prop of properties(tree)) {
      const k = key(prop),
        v = value(prop);
      if (format === 'package-json') {
        if (k === 'name' && v.type === 'string')
          fact([k], 'package-name', String(v.value), v);
        if (k === 'type' && v.type === 'string')
          fact([k], 'package-type', String(v.value), v);
        if (['main', 'module', 'types', 'typings'].includes(k)) {
          if (v.type === 'string') entry(v, [k], k as EntryPoint['kind']);
          else
            record.diagnostics.push({
              code: 'unsupported_entry_field',
              message: 'An entry-point field has an unsupported value shape.',
            });
        }
        if (k === 'bin') {
          if (v.type === 'string') entry(v, [k], 'bin');
          else
            for (const bin of properties(v))
              if (value(bin).type === 'string')
                entry(value(bin), [k, key(bin)], 'bin');
        }
        if (k === 'exports') entry(v, [k], 'exports');
        if (k === 'scripts')
          for (const script of properties(v))
            fact(
              [k, key(script)],
              'script-name',
              key(script),
              script.children![0]!,
            );
        if (
          [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
          ].includes(k)
        )
          for (const dependency of properties(v))
            fact(
              [k, key(dependency)],
              'dependency-name',
              key(dependency),
              dependency.children![0]!,
            );
      } else {
        if (k === 'extends') fact([k], 'compiler-extends', strings(v), v);
        if (k === 'references' && v.type === 'array')
          for (const [i, item] of (v.children ?? []).entries())
            for (const child of properties(item))
              if (key(child) === 'path' && value(child).type === 'string')
                fact(
                  [k, String(i), 'path'],
                  'project-reference',
                  String(value(child).value),
                  value(child),
                );
        if (k === 'compilerOptions')
          for (const option of properties(v)) {
            const optionKey = key(option),
              optionValue = value(option);
            if (
              [
                'target',
                'module',
                'moduleResolution',
                'jsx',
                'baseUrl',
                'rootDir',
                'outDir',
                'strict',
                'allowJs',
                'checkJs',
                'resolveJsonModule',
                'noEmit',
              ].includes(optionKey) &&
              ['string', 'boolean'].includes(optionValue.type)
            )
              fact(
                [k, optionKey],
                'compiler-option',
                optionValue.value as string | boolean,
                optionValue,
              );
            if (optionKey === 'paths')
              for (const alias of properties(optionValue))
                fact(
                  [k, optionKey, key(alias)],
                  'path-alias',
                  strings(value(alias)),
                  alias,
                );
          }
      }
    }
  } catch {
    record.facts = [];
    declarations.length = 0;
    record.diagnostics.push({
      code: 'configuration_uncertain',
      message:
        'Configuration is malformed, duplicated or too deeply nested; no configuration facts or entry points were accepted.',
    });
  }
  return { record, declarations };
}
