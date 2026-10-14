'use strict';

/**
 * Server HTTP lokal untuk menyajikan ekspor statis aplikasi POS
 * (`desktop/app/`) di dalam installer. Dipakai mode offline-first: jendela
 * memuat `http://127.0.0.1:<port>/kasir` sehingga aset absolut (/_next/...),
 * cookie, dan localStorage tetap stabil.
 *
 * Hanya mendengarkan di 127.0.0.1 dan port acak.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function resolveFile(rootDir, urlPath) {
  const root = path.resolve(rootDir);
  let rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  if (rel === '') rel = 'kasir/index.html';

  let file = path.resolve(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) return null; // cegah path traversal

  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) {
      file = file + '.html';
    }
  } catch {
    /* abaikan */
  }
  return file;
}

function startLocalServer(rootDir) {
  return new Promise((resolve, reject) => {
    const fallback = path.join(rootDir, 'kasir', 'index.html');

    const server = http.createServer((req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405);
          res.end('Method Not Allowed');
          return;
        }
        const reqPath = (req.url || '/').split('?')[0];
        let file = resolveFile(rootDir, req.url || '/');
        if (!file || !fs.existsSync(file)) {
          // Rute aplikasi (tanpa ekstensi berkas) boleh jatuh ke halaman kasir
          // (SPA). Aset yang hilang (mis. /_next/*.js) HARUS 404 — kalau tidak,
          // browser menerima HTML sebagai JavaScript → halaman blank.
          const hasExt = path.extname(reqPath) !== '';
          file = !hasExt && fs.existsSync(fallback) ? fallback : null;
        }
        if (!file) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(file).on('error', () => res.end()).pipe(res);
      } catch {
        res.writeHead(500);
        res.end('Internal error');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { startLocalServer };
