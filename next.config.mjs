const isDesktopExport = process.env.DESKTOP_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mode ekspor statis untuk aplikasi desktop offline-first
  // (jalankan `npm run export:desktop`). Di mode ini tidak boleh ada
  // middleware / API route / redirects — lihat scripts/export-desktop.mjs.
  output: isDesktopExport ? 'export' : undefined,
  trailingSlash: isDesktopExport ? true : undefined,
  images: isDesktopExport ? { unoptimized: true } : undefined,
  redirects: isDesktopExport
    ? undefined
    : async () => [
        // `/` → `/kasir`. Vercel memancarkan 307 dengan header Location yang
        // benar. Tidak didukung di mode export (dihandle client-side).
        { source: '/', destination: '/kasir', permanent: false },
      ],
};

export default nextConfig;
