/** Env accessor — lazy supaya `next build` tetap jalan walau env belum diisi. */

function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/\/+$/, '');
}

export const env = {
  get supabaseUrl() {
    return (
      clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
      clean(process.env.SUPABASE_URL) ||
      'http://127.0.0.1:54321'
    );
  },
  get supabaseAnonKey() {
    return (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ''
    );
  },
  get serviceRoleKey() {
    return (
      process.env.SERVICE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ''
    );
  },
  get siteUrl() {
    return clean(process.env.NEXT_PUBLIC_SITE_URL) || 'http://localhost:3001';
  },
  get appName() {
    return process.env.NEXT_PUBLIC_APP_NAME || 'KasirPro POS';
  },
};