import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
let isolatedRoot = '';
let panelUrl = '';
let serverModule: typeof import('../../src/web/server.js');
let databaseModule: typeof import('../../src/db/connection.js');

test.beforeAll(async () => {
  const workspaceRoot = path.join(repositoryRoot, 'workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  isolatedRoot = fs.mkdtempSync(path.join(workspaceRoot, '.e2e-dashboard-'));

  fs.cpSync(path.join(repositoryRoot, 'web'), path.join(isolatedRoot, 'web'), { recursive: true });
  fs.cpSync(path.join(repositoryRoot, 'skills'), path.join(isolatedRoot, 'skills'), { recursive: true });
  fs.cpSync(path.join(repositoryRoot, 'agents'), path.join(isolatedRoot, 'agents'), { recursive: true });

  const lucideSource = path.join(repositoryRoot, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js');
  const lucideTarget = path.join(isolatedRoot, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js');
  fs.mkdirSync(path.dirname(lucideTarget), { recursive: true });
  fs.copyFileSync(lucideSource, lucideTarget);

  process.chdir(isolatedRoot);
  const configModule = await import('../../src/config/loader.js');
  databaseModule = await import('../../src/db/connection.js');
  const projectsModule = await import('../../src/projects/service.js');
  serverModule = await import('../../src/web/server.js');

  configModule.loadConfig();
  const port = 4700 + Math.floor(Math.random() * 500);
  configModule.updateConfig({ web: { enabled: true, port } });
  databaseModule.initDatabase();
  projectsModule.ensureLegacyProject();
  serverModule.startWebServer();
  panelUrl = serverModule.getWebPanelUrl(port);

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(panelUrl);
      await response.body?.cancel();
      if (response.ok) break;
    } catch { /* servidor ainda iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test.afterAll(() => {
  serverModule?.stopWebServer();
  databaseModule?.closeDatabase();
  process.chdir(repositoryRoot);
});

test('abre o painel autenticado e cria um projeto', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto(panelUrl);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#view-projects')).toContainText('Projetos');

  await page.locator('#new-project-top').click();
  await page.locator('#np-name').fill('Projeto E2E');
  await page.locator('#np-submit').click();

  await expect(page).toHaveURL(/#\/project\//);
  await expect(page.locator('#view-project-detail')).toContainText('Projeto E2E');
  expect(browserErrors).toEqual([]);
});
