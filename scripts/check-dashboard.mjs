import fs from 'node:fs';
import vm from 'node:vm';
import { dashboardSources } from './dashboard-sources.mjs';

for (const file of dashboardSources) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
}

const html = fs.readFileSync('web/index.html', 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
  .map(match => match[1].replace(/^\//, '').replace(/\?.*$/, ''));
let previousIndex = -1;
for (const file of dashboardSources) {
  const index = scripts.indexOf(file.replace(/^web\//, ''));
  if (index < 0) throw new Error(`Fonte do dashboard ausente em web/index.html: ${file}`);
  if (index <= previousIndex) throw new Error(`Ordem de carregamento invalida em web/index.html: ${file}`);
  previousIndex = index;
}
