export const NO_EVIDENCE_LIMITATION =
  'No analyzable evidence establishes this folder’s purpose or behavior.';
export function standardLimitations(partial: boolean): string[] {
  return [
    'Mechanical citation checks do not establish semantic truth. Review explanations against source.',
    'Static file references are not a complete call graph. Tests were not executed.',
    ...(partial
      ? [
          'Partial coverage: unsupported, unreadable, oversized, sensitive or invalid source remains unanalyzed; see the inventory report.',
        ]
      : []),
  ];
}
