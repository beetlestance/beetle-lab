import { ESLint } from 'eslint';
import { sourceFiles } from './source-files.js';

const roots = ['app', 'agent', 'contracts', 'web', 'engines/k6', 'tools'];
const files = (await Promise.all(roots.map(root => sourceFiles(root)))).flat();
const eslint = new ESLint();
const results = await eslint.lintFiles(files);
const formatter = await eslint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) console.log(output);
if (results.some(result => result.errorCount > 0 || result.warningCount > 0)) process.exitCode = 1;
