import type http from 'node:http';

export const MAX_BODY_BYTES = 12 * 1024 * 1024;

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

export async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type deve ser application/json');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      req.resume();
      throw new HttpError(413, `Corpo excede o limite de ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'JSON deve conter um objeto');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'JSON invalido');
  }
}
