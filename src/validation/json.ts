import { parseTree, type ParseError, type Node } from 'jsonc-parser';
/** JSON.parse alone accepts duplicate keys. Persisted metadata must be unambiguous. */
export function strictJson(text: string): unknown {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  if (!tree || errors.length) throw new Error('Invalid metadata JSON.');
  const pending: Node[] = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === 'object') {
      const keys =
        node.children?.map((child) => child.children?.[0]?.value as string) ??
        [];
      if (new Set(keys).size !== keys.length)
        throw new Error('Duplicate metadata key.');
    }
    pending.push(...(node.children ?? []));
  }
  return JSON.parse(text) as unknown;
}
