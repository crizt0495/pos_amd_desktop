#!/usr/bin/env node
/**
 * Build ekspor statis aplikasi untuk dibundel ke installer desktop
 * (offline-first). Hasilnya di `out/` lalu disalin ke `desktop/app/` supaya
 * ikut masuk ke `app.asar` installer.
 *
 * Next.js `output: 'export'` tidak mendukung middleware, API route, dan
 * redirects. Karena itu berkas berikut disingkirkan sementara saat build:
 *   - src/middleware.ts
 *   - src/app/api
 *   - src/app/login
 *
 * Jalankan dari akar repo:  npm run export:desktop
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const stash = path.join(root, '.desktop-export-stash');
const outDir = path.join(root, 'out');
const desktopApp = path.join(root, 'desktop', 'app');

const STASHED = ['src/middleware.ts', 'src/app/api', 'src/app/login'];

function log(msg) {
  console.log(`[export:desktop] ${msg}`);
}

function restore() {
  if (!existsSync(stash)) return;
  for (const rel of STASHED) {
    const src = path.join(stash, rel);
    if (existsSync(src)) {
      const dest = path.join(root, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      renameSync(src, dest);
    }
  }
  rmSync(stash, { recursive: true, force: true });
}

// Bersihkan sisa stash dari run sebelumnya yang gagal.
if (existsSync(stash)) restore();

let failed = false;
try {
  log('menyingkirkan middleware/api/login sementara...');
  for (const rel of STASHED) {
    const src = path.join(root, rel);
    if (!existsSync(src)) continue;
    const dest = path.join(stash, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(src, dest);
  }

  rmSync(outDir, { recursive: true, force: true });
  log('next build (DESKTOP_EXPORT=1)...');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(npx, ['next', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, DESKTOP_EXPORT: '1' },
  });
  if (res.status !== 0) throw new Error(`next build gagal (kode ${res.status})`);

  if (!existsSync(path.join(outDir, 'kasir', 'index.html'))) {
    throw new Error('Ekspor tidak berisi kasir/index.html — periksa konfigurasi.');
  }

  log('menyalin out/ → desktop/app/ ...');
  rmSync(desktopApp, { recursive: true, force: true });
  cpSync(outDir, desktopApp, { recursive: true });
  log('selesai.');
} catch (err) {
  failed = true;
  console.error(`[export:desktop] GAGAL: ${err.message}`);
} finally {
  restore();
  log('berkas middleware/api/login dikembalikan.');
}

process.exit(failed ? 1 : 0);
