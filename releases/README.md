# KasirPro POS — Download File Rilis

Karena file installer (`.exe` dan `.deb`) besar dan dibuat otomatis via CI, mereka **tidak disimpan di repo ini**. Namun sangat mudah dicari di satu tempat:

## Link Langsung
👉 **https://github.com/crizt0495/pos_amd_desktop/releases**

Di halaman tersebut akan ada 2 file untuk setiap versi:
- `KasirPro-POS-Setup-vX.Y.Z.exe` → Windows (`releases/windows/`)
- `KasirPro_POS_X.Y.Z_amd64.deb` → Linux (`releases/linux/`)

## Struktur Folder Repo Ini
- `src/` → kode aplikasi web
- `desktop/` → kode Electron (builder, assets)
- `releases/windows/` → penjelasan file Windows
- `releases/linux/` → penjelasan file Linux
- `.github/workflows/` → build otomatis (Windows + Linux)
