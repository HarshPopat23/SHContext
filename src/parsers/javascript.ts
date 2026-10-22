import { createRequire } from 'node:module';
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type {
  ExtractedSymbol,
  FileAnalysis,
  ModuleStructure,
  SourceSpan,
} from '../core/contracts/index.js';
import {
  FileAnalysisSchema,
  ModuleStructureSchema,
} from '../core/contracts/index.js';
import { parseSource } from './syntax.js';
import { locations } from './locations.js';

// Babel 7 traverse is CommonJS; select its documented default explicitly in Node ESM.
const traverse = createRequire(import.meta.url)('@babel/traverse')
  .default as typeof import('@babel/traverse').default;
function keyName(node: t.Node | null | undefined): string | null {
  return t.isIdentifier(node)
    ? node.name
    : t.isStringLiteral(node)
      ? node.value
      : t.isNumericLiteral(node)
        ? String(node.value)
        : t.isPrivateName(node)
          ? `#${node.id.name}`
          : null;
}
function wrapped(
  node: t.Node,
): node is
  | t.TSAsExpression
  | t.TSTypeAssertion
  | t.TSNonNullExpression
  | t.TSSatisfiesExpression
  | t.ParenthesizedExpression {
  return (
    t.isTSAsExpression(node) ||
    t.isTSTypeAssertion(node) ||
    t.isTSNonNullExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    t.isParenthesizedExpression(node)
  );
}
function unwrap(node: t.Node | null | undefined): t.Node | null | undefined {
  while (node && wrapped(node)) node = node.expression;
  return node;
}
function expressionOwner(path: NodePath): NodePath {
  while (path.parentPath && wrapped(path.parentPath.node))
    path = path.parentPath;
  return path;
}
function expressionName(path: NodePath): string | null {
  const parent = expressionOwner(path).parent;
  if (t.isClassPrivateProperty(parent)) return keyName(parent.key);
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id))
    return parent.id.name;
  if (
    (t.isClassProperty(parent) || t.isObjectProperty(parent)) &&
    !parent.computed
  )
    return keyName(parent.key);
  if (
    t.isAssignmentExpression(parent) &&
    t.isMemberExpression(parent.left) &&
    !parent.left.computed
  )
    return keyName(parent.left.property);
  return null;
}
export function extractJavaScript(
  path: string,
  sha256: string,
  text: string,
): { analysis: FileAnalysis; module: ModuleStructure } {
  const ast = parseSource(path, text),
    loc = locations(path, sha256, text);
  const module: ModuleStructure = {
    path,
    sha256,
    imports: [],
    exports: [],
    diagnostics: [],
  };
  const references: FileAnalysis['references'] = [];
  const symbols: {
    node: t.Node;
    binding: number | null;
    top: boolean;
    symbol: ExtractedSymbol;
  }[] = [];
  const mutated = new Set<string>();
  const span = (node: t.Node): SourceSpan => loc.span(node.start!, node.end!);
  const addSymbol = (
    node: t.Node,
    name: string | null,
    kind: ExtractedSymbol['kind'],
    binding: number | null,
    top: boolean,
  ) => {
    const evidence = span(node);
    symbols.push({
      node,
      binding,
      top,
      symbol: {
        id: 'S1',
        name: name?.trim() ? name : null,
        kind,
        exported: false,
        range: { start_line: evidence.start_line, end_line: evidence.end_line },
      },
    });
  };
  const topLevel = (p: NodePath): boolean =>
    !!(
      p.parentPath?.isProgram() === true ||
      ((p.parentPath?.isExportNamedDeclaration() ||
        p.parentPath?.isExportDefaultDeclaration()) &&
        p.parentPath.parentPath?.isProgram() === true)
    );
  traverse(ast, {
    enter(p) {
      const n = p.node;
      if (
        (t.isAssignmentExpression(n) && t.isIdentifier(n.left)) ||
        (t.isUpdateExpression(n) && t.isIdentifier(n.argument))
      ) {
        const id = t.isAssignmentExpression(n) ? n.left : n.argument;
        if (
          t.isIdentifier(id) &&
          ['require', 'module', 'exports'].includes(id.name) &&
          !p.scope.getBinding(id.name)
        )
          mutated.add(id.name);
      }
      if (
        t.isFunctionDeclaration(n) ||
        t.isClassDeclaration(n) ||
        t.isTSDeclareFunction(n)
      )
        addSymbol(
          n,
          n.id?.name ?? null,
          t.isClassDeclaration(n) ? 'class' : 'function',
          n.id?.start ?? null,
          topLevel(p),
        );
      else if (t.isVariableDeclarator(n)) {
        const ids = t.getBindingIdentifiers(n.id);
        const value = unwrap(n.init);
        for (const id of Object.values(ids))
          addSymbol(
            n,
            id.name,
            t.isFunctionExpression(value) || t.isArrowFunctionExpression(value)
              ? 'function'
              : t.isClassExpression(value)
                ? 'class'
                : 'variable',
            id.start ?? null,
            p.parentPath?.isVariableDeclaration() === true &&
              topLevel(p.parentPath),
          );
      } else if (
        t.isFunctionExpression(n) ||
        t.isArrowFunctionExpression(n) ||
        t.isClassExpression(n)
      ) {
        if (t.isVariableDeclarator(expressionOwner(p).parent)) return;
        const name =
          expressionName(p) ?? ('id' in n ? (n.id?.name ?? null) : null);
        if (
          name !== null ||
          expressionOwner(p).parentPath?.isExportDefaultDeclaration()
        )
          addSymbol(
            n,
            name,
            t.isClassExpression(n) ? 'class' : 'function',
            null,
            topLevel(p),
          );
      } else if (
        t.isClassMethod(n) ||
        t.isClassPrivateMethod(n) ||
        t.isObjectMethod(n) ||
        t.isTSDeclareMethod(n)
      ) {
        const owner = p.findParent(
          (q) => q.isClassDeclaration() || q.isClassExpression(),
        );
        const ownerNode = owner?.node;
        const ownerName =
          ownerNode &&
          (t.isClassDeclaration(ownerNode) || t.isClassExpression(ownerNode))
            ? (ownerNode.id?.name ?? (owner ? expressionName(owner) : null))
            : null;
        const name = n.computed ? null : keyName(n.key);
        addSymbol(
          n,
          name === null ? null : ownerName ? `${ownerName}.${name}` : name,
          'function',
          null,
          false,
        );
      } else if (
        t.isTSInterfaceDeclaration(n) ||
        t.isTSTypeAliasDeclaration(n) ||
        t.isTSEnumDeclaration(n) ||
        t.isTSModuleDeclaration(n)
      ) {
        addSymbol(
          n,
          keyName(n.id),
          t.isTSInterfaceDeclaration(n)
            ? 'interface'
            : t.isTSTypeAliasDeclaration(n)
              ? 'type'
              : t.isTSEnumDeclaration(n)
                ? 'enum'
                : 'namespace',
          n.id.start ?? null,
          topLevel(p),
        );
      }
    },
  });
  const exportedLocal = (p: NodePath, name: string) => {
    const start = p.scope.getBinding(name)?.identifier.start;
    for (const record of symbols)
      if (
        (start !== undefined && record.binding === start) ||
        (start === undefined && record.top && record.symbol.name === name)
      )
        record.symbol.exported = true;
  };
  const exportedValue = (p: NodePath, value: t.Node | null | undefined) => {
    value = unwrap(value);
    if (t.isIdentifier(value)) exportedLocal(p, value.name);
    else if (value)
      for (const record of symbols)
        if (record.node === value) record.symbol.exported = true;
  };
  const reference = (
    node: t.Node,
    kind: FileAnalysis['references'][number]['kind'],
    source: t.Node | null | undefined,
  ) => {
    const value = t.isStringLiteral(source) ? source.value : null;
    const item = {
      kind,
      specifier: value,
      start_byte: loc.byte(node.start!),
      end_byte: loc.byte(node.end!),
      evidence: span(node),
    };
    references.push(item);
    return item.start_byte;
  };
  const addExport = (
    p: NodePath,
    node: t.Node,
    name: string,
    local: string | null,
    kind: ModuleStructure['exports'][number]['kind'],
    type_only = false,
    reference_start_byte: number | null = null,
  ) => {
    if (kind !== 'commonjs' && !p.parentPath?.isProgram()) return;
    module.exports.push({
      name,
      local,
      kind,
      type_only,
      reference_start_byte,
      evidence: span(node),
    });
    if (local && kind !== 're-export') exportedLocal(p, local);
  };
  const globalObject = (p: NodePath, name: string) =>
    !p.scope.getBinding(name) &&
    !mutated.has(name) &&
    !p.findParent((q) => q.isWithStatement());
  function commonExport(
    p: NodePath,
    left: t.LVal | t.OptionalMemberExpression,
  ): string | null {
    if (!t.isMemberExpression(left) || left.computed) return null;
    if (
      t.isIdentifier(left.object, { name: 'module' }) &&
      t.isIdentifier(left.property, { name: 'exports' }) &&
      globalObject(p, 'module')
    )
      return 'module.exports';
    if (
      t.isIdentifier(left.object, { name: 'exports' }) &&
      globalObject(p, 'exports')
    )
      return keyName(left.property);
    if (
      t.isMemberExpression(left.object) &&
      !left.object.computed &&
      t.isIdentifier(left.object.object, { name: 'module' }) &&
      t.isIdentifier(left.object.property, { name: 'exports' }) &&
      globalObject(p, 'module')
    )
      return keyName(left.property);
    return null;
  }
  traverse(ast, {
    enter(p) {
      const n = p.node;
      if (t.isImportDeclaration(n)) {
        const start = reference(n, 'import', n.source);
        if (!n.specifiers.length)
          module.imports.push({
            kind: 'side-effect',
            imported: null,
            local: null,
            type_only: false,
            reference_start_byte: start,
            evidence: span(n),
          });
        for (const specifier of n.specifiers)
          module.imports.push({
            kind: t.isImportDefaultSpecifier(specifier)
              ? 'default'
              : t.isImportNamespaceSpecifier(specifier)
                ? 'namespace'
                : 'named',
            imported: t.isImportDefaultSpecifier(specifier)
              ? 'default'
              : t.isImportNamespaceSpecifier(specifier)
                ? '*'
                : keyName(specifier.imported),
            local: specifier.local.name,
            type_only:
              n.importKind === 'type' ||
              (t.isImportSpecifier(specifier) &&
                specifier.importKind === 'type'),
            reference_start_byte: start,
            evidence: span(specifier),
          });
      } else if (t.isExportNamedDeclaration(n)) {
        const start = n.source ? reference(n, 're-export', n.source) : null;
        if (n.declaration) {
          for (const record of symbols)
            if (
              record.top &&
              record.node.start! >= n.declaration.start! &&
              record.node.end! <= n.declaration.end!
            ) {
              record.symbol.exported = true;
              addExport(
                p,
                record.node,
                record.symbol.name ?? 'default',
                record.symbol.name,
                'local',
                n.exportKind === 'type' ||
                  ['interface', 'type'].includes(record.symbol.kind),
              );
            }
        }
        for (const specifier of n.specifiers) {
          const local = t.isExportSpecifier(specifier)
            ? keyName(specifier.local)
            : null;
          addExport(
            p,
            specifier,
            keyName(specifier.exported) ?? '*',
            n.source ? null : local,
            n.source ? 're-export' : 'local',
            n.exportKind === 'type' ||
              (t.isExportSpecifier(specifier) &&
                specifier.exportKind === 'type'),
            start,
          );
        }
      } else if (t.isExportDefaultDeclaration(n) && p.parentPath?.isProgram()) {
        const local = t.isIdentifier(n.declaration)
          ? n.declaration.name
          : 'id' in n.declaration
            ? (n.declaration.id?.name ?? null)
            : null;
        addExport(
          p,
          n,
          'default',
          local,
          'default',
          t.isTSInterfaceDeclaration(n.declaration),
        );
        exportedValue(p, n.declaration);
      } else if (t.isExportAllDeclaration(n))
        addExport(
          p,
          n,
          '*',
          null,
          're-export',
          n.exportKind === 'type',
          reference(n, 're-export', n.source),
        );
      else if (
        t.isTSImportEqualsDeclaration(n) &&
        t.isTSExternalModuleReference(n.moduleReference)
      ) {
        const start = reference(n, 'require', n.moduleReference.expression);
        module.imports.push({
          kind: 'require',
          imported: '*',
          local: n.id.name,
          type_only: n.importKind === 'type',
          reference_start_byte: start,
          evidence: span(n),
        });
        if (n.isExport)
          addExport(
            p,
            n,
            n.id.name,
            n.id.name,
            'local',
            n.importKind === 'type',
          );
      } else if (t.isTSImportType(n)) {
        const start = reference(n, 'import', n.argument);
        module.imports.push({
          kind: 'namespace',
          imported: '*',
          local: null,
          type_only: true,
          reference_start_byte: start,
          evidence: span(n),
        });
      } else if (t.isTSExportAssignment(n) && p.parentPath?.isProgram()) {
        addExport(
          p,
          n,
          'export=',
          t.isIdentifier(n.expression) ? n.expression.name : null,
          'commonjs',
        );
        exportedValue(p, n.expression);
      } else if (t.isImportExpression(n))
        reference(n, 'dynamic-import', n.source);
      else if (
        t.isCallExpression(n) &&
        t.isIdentifier(n.callee, { name: 'require' })
      ) {
        if (!globalObject(p, 'require')) {
          module.diagnostics.push({
            code: 'uncertain_require',
            message:
              'A shadowed, reassigned or dynamically scoped require call is outside the dependency scope.',
          });
          return;
        }
        if (n.arguments.length !== 1) {
          module.diagnostics.push({
            code: 'unsupported_require',
            message: 'Only single-argument direct require calls are extracted.',
          });
          return;
        }
        const start = reference(n, 'require', n.arguments[0]);
        const local =
          t.isVariableDeclarator(p.parent) && t.isIdentifier(p.parent.id)
            ? p.parent.id.name
            : null;
        module.imports.push({
          kind: 'require',
          imported: '*',
          local,
          type_only: false,
          reference_start_byte: start,
          evidence: span(n),
        });
      } else if (t.isAssignmentExpression(n, { operator: '=' })) {
        const name = commonExport(p, n.left);
        if (name !== null) {
          addExport(
            p,
            n,
            name,
            t.isIdentifier(n.right) ? n.right.name : null,
            'commonjs',
          );
          exportedValue(p, n.right);
          if (name === 'module.exports' && t.isObjectExpression(n.right))
            for (const property of n.right.properties)
              if (t.isObjectProperty(property) && !property.computed) {
                const key = keyName(property.key);
                if (key !== null) {
                  addExport(
                    p,
                    property,
                    key,
                    t.isIdentifier(property.value) ? property.value.name : null,
                    'commonjs',
                  );
                  exportedValue(p, property.value);
                }
              }
        }
      }
    },
  });
  symbols.sort(
    (a, b) =>
      a.node.start! - b.node.start! || (a.binding ?? 0) - (b.binding ?? 0),
  );
  symbols.forEach((r, i) => {
    r.symbol.id = `S${i + 1}`;
  });
  references.sort(
    (a, b) => a.start_byte - b.start_byte || a.end_byte - b.end_byte,
  );
  const analysis = FileAnalysisSchema.parse({
    schema_version: 1,
    path,
    sha256,
    line_count: loc.line_count,
    language: /\.[cm]?tsx?$/i.test(path) ? 'typescript' : 'javascript',
    mode: 'structural',
    disposition: 'analyzed',
    symbols: symbols.map((r) => r.symbol),
    references,
    diagnostics: [],
  });
  return { analysis, module: ModuleStructureSchema.parse(module) };
}
