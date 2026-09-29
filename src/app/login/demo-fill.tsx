'use client';

/**
 * Tombol kecil untuk mengisi akun demo — satu-satunya JS di halaman login,
 * opsional (halaman tetap berfungsi tanpa hidrasi penuh).
 */
export function DemoFill({ username, password }: { username: string; password: string }) {
  function isi() {
    const u = document.querySelector<HTMLInputElement>('input[name="username"]');
    const p = document.querySelector<HTMLInputElement>('input[name="password"]');
    if (u) u.value = username;
    if (p) p.value = password;
  }

  return (
    <button
      type="button"
      onClick={isi}
      className="btn-outline h-8 w-full text-[12px]"
    >
      Isi otomatis
    </button>
  );
}