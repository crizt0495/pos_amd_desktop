import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KasirPro POS — Aplikasi Kasir',
  description:
    'KasirPro POS — aplikasi kasir web (layout desktop): transaksi, produk, laporan. Login akun KasirPro.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}