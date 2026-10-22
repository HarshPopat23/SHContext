import { extname, basename } from 'node:path';
import { parseSource } from '../parsers/syntax.js';
import type { InventoryEntry } from '../core/contracts/index.js';

export const DETECTOR_VERSION = 'credentials-v2';
export const DEFAULT_POLICY_VERSION = 'scanner-policy-v1';
export const PARSER_VERSION = 'babel-parser-7.29.9-scan-v1';
export function sensitiveContent(text: string): boolean {
  return (
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(text) ||
    /\bAKIA[A-Z0-9]{16}\b/.test(text) ||
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(text) ||
    /\bgithub_pat_[A-Za-z0-9_]{50,}\b/.test(text) ||
    /\bgsk_[A-Za-z0-9]{40,}\b/.test(text) ||
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/.test(text)
  );
}
export function classify(
  path: string,
  text: string,
): Pick<InventoryEntry, 'disposition' | 'reason' | 'mode' | 'diagnostics'> {
  const extension = extname(path).toLowerCase(),
    name = basename(path).toLowerCase();
  if (sensitiveContent(text))
    return {
      disposition: 'skipped',
      reason: 'sensitive_content',
      mode: 'none',
      diagnostics: [
        {
          code: 'credential_pattern',
          message: 'File excluded by the local credential-pattern detector.',
        },
      ],
    };
  if (
    /\.min\.(?:js|css)$/i.test(path) ||
    /(?:^|\n)\s*(?:\/\*+|\/\/|#|<!--)\s*(?:@generated\b|code generated\b[^\n]*do not edit\b|auto[- ]generated\b[^\n]*do not edit\b)/i.test(
      text.slice(0, 4096),
    )
  )
    return {
      disposition: 'skipped',
      reason: 'generated_code',
      mode: 'none',
      diagnostics: [],
    };
  if (
    ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(
      extension,
    )
  ) {
    try {
      parseSource(path, text);
    } catch (error) {
      const syntax = error instanceof SyntaxError;
      return {
        disposition: 'parse-error',
        reason: syntax ? 'syntax_error' : 'parser_failed',
        mode: 'structural',
        diagnostics: [
          {
            code: syntax ? 'syntax_error' : 'parser_failed',
            message: syntax
              ? 'Source failed the configured JavaScript/TypeScript syntax check.'
              : 'Source parser failed; no syntax facts are available.',
          },
        ],
      };
    }
    return {
      disposition: 'analyzed',
      reason: 'supported_source',
      mode: 'structural',
      diagnostics: [],
    };
  }
  if (
    ['.md', '.mdx', '.txt'].includes(extension) ||
    ['readme', 'license'].includes(name)
  )
    return {
      disposition: 'analyzed',
      reason: 'supported_text',
      mode: 'text',
      diagnostics: [],
    };
  if (
    ['.json', '.jsonc', '.yaml', '.yml', '.toml'].includes(extension) ||
    ['.gitignore', '.shcontextignore'].includes(name)
  )
    return {
      disposition: 'analyzed',
      reason: 'supported_configuration',
      mode: 'configuration',
      diagnostics: [],
    };
  return {
    disposition: 'inventory-only',
    reason: 'unsupported_language',
    mode: 'inventory-only',
    diagnostics: [],
  };
}
