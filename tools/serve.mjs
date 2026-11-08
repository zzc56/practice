import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const DEFAULT_ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/** A small, dependency-free preview server. Production uses Nginx. */
export function createStaticServer({ root = DEFAULT_ROOT } = {}) {
  const absoluteRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
    const finish = (status, message, extra = {}) => {
      response.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...extra,
      });
      response.end(request.method === 'HEAD' ? undefined : message);
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      finish(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      finish(400, 'Invalid request path');
      return;
    }

    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) {
      finish(403, 'Forbidden');
      return;
    }

    let filename = path.resolve(absoluteRoot, `.${pathname}`);
    if (!isInside(absoluteRoot, filename)) {
      finish(403, 'Forbidden');
      return;
    }

    try {
      const rootReal = await realpath(absoluteRoot);
      if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      const fileReal = await realpath(filename);
      if (!isInside(rootReal, fileReal)) {
        finish(403, 'Forbidden');
        return;
      }
      const fileStat = await stat(fileReal);
      if (!fileStat.isFile()) {
        finish(404, 'Not found');
        return;
      }
      const headers = {
        'Content-Type': MIME_TYPES[path.extname(fileReal).toLowerCase()] || 'application/octet-stream',
        'Content-Length': fileStat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      };
      if (request.method === 'HEAD') {
        response.writeHead(200, headers);
        response.end();
      } else {
        const body = await readFile(fileReal);
        response.writeHead(200, headers);
        response.end(body);
      }
    } catch (error) {
      finish(error.code === 'EACCES' ? 403 : 404, error.code === 'EACCES' ? 'Forbidden' : 'Not found');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8713);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1 到 65535 的整数。');
    process.exit(1);
  }
  const server = createStaticServer();
  server.on('error', error => {
    console.error(`预览服务启动失败：${error.code || error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`知序预览：http://${host}:${port}`);
    console.log('按 Ctrl+C 结束。正式部署请使用随附的 Nginx 或 Docker 配置。');
  });
}
