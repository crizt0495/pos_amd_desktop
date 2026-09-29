/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Entry point: root → halaman kasir (middleware akan mengalihkan ke
      // /login bila belum login). Redirect di level konfigurasi supaya Vercel
      // memancarkan 307 dengan header Location yang benar.
      { source: '/', destination: '/kasir', permanent: false },
    ];
  },
};

export default nextConfig;