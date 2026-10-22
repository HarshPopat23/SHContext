import { extname } from 'node:path';
import { parse, type ParserPlugin } from '@babel/parser';

export const STRUCTURE_PARSER_VERSION = 'babel-7.29.9-structure-v1';
/** Same fixed dialect for scan and extraction; never loads repository plugins. */
export function parseSource(path: string, text: string) {
  const extension = extname(path).toLowerCase();
  const plugins: ParserPlugin[] = [];
  if (['.ts', '.tsx', '.mts', '.cts'].includes(extension))
    plugins.push([
      'typescript',
      {
        dts: /\.d\.[cm]?ts$/i.test(path),
        disallowAmbiguousJSXLike: ['.mts', '.cts'].includes(extension),
      },
    ]);
  if (['.jsx', '.tsx'].includes(extension)) plugins.push('jsx');
  return parse(text, {
    sourceType:
      extension === '.cjs'
        ? 'commonjs'
        : ['.mjs', '.mts'].includes(extension)
          ? 'module'
          : 'unambiguous',
    plugins,
    errorRecovery: false,
    attachComment: false,
    createImportExpressions: true,
  });
}
