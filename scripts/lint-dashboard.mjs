import fs from 'node:fs';
import { ESLint } from 'eslint';
import { dashboardSources } from './dashboard-sources.mjs';

const source = dashboardSources
  .map(file => `// source: ${file}\n${fs.readFileSync(file, 'utf8')}`)
  .join('\n\n');
const eslint = new ESLint();
const results = await eslint.lintText(source, { filePath: 'web/dashboard.bundle.js' });
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);
if (output) process.stdout.write(output);
if (results.some(result => result.errorCount > 0)) process.exitCode = 1;
