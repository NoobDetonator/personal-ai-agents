import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { json, setSecurityHeaders } from './http.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function serveStatic(urlPath: string, res: http.ServerResponse): void {
  const staticDir = path.join(process.cwd(), 'web');
  const lucideFile = path.join(process.cwd(), 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js');
  let filePath: string;

  if (urlPath === '/vendor/lucide.js') {
    filePath = lucideFile;
  } else {
    const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    filePath = path.join(staticDir, relativePath);
    const relativeCheck = path.relative(staticDir, filePath);
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
      json(res, 404, { error: 'nao encontrado' });
      return;
    }
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    setSecurityHeaders(res);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-cache');
  res.writeHead(200, { 'Content-Type': MIME[extension] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}
