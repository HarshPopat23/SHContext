import greet, { helper as renamed } from './greet.ts';
import type { Thing } from './types';
import fs from 'node:fs';
import external from 'example-package';
import internal from '@app/internal';
import '#private';
import './missing';
import './ambiguous';
import './excluded';
import '../context/hidden.ts';
import '../../../outside';
export { default as hello } from './greet.ts';
export * from './types.ts';
const common = require('./common.cjs');
const loaded = import('./greet.ts');
const computed = import(runtimePath);
export type Loaded = import('./types.ts').Thing;
export function entry(value: Thing) { return greet(value.name) + renamed(); }
