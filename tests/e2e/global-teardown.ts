import fs from 'node:fs';
import path from 'node:path';

export default function globalTeardown(): void {
  const workspaceRoot = path.join(process.cwd(), 'workspace');
  if (!fs.existsSync(workspaceRoot)) return;

  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.e2e-dashboard-')) continue;
    fs.rmSync(path.join(workspaceRoot, entry.name), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
