import type http from 'node:http';
import type { BusEvent } from './bus.js';
import { setSecurityHeaders } from './http.js';

const clients = new Set<http.ServerResponse>();

export function handleSse(res: http.ServerResponse): void {
  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(':ok\n\n');
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(event: BusEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(data);
}

export function keepAlive(): void {
  for (const client of clients) client.write(':ka\n\n');
}

export function closeSseClients(): void {
  for (const client of clients) client.end();
  clients.clear();
}
