#!/usr/bin/env python3
"""
Regenerasi ikon KasirPro POS dari logo sumber.

Membutuhkan Pillow:  python3 -m pip install Pillow

Contoh:
    python3 scripts/generate-icons.py \
        --source /path/ke/logo-512.png

Menghasilkan:
    build/icon.png    (512x512, dipakai electron-builder)
    build/icon.ico    (multi-size 16..256, ikon .exe & installer)
    assets/icon.png   (256x256, ikon jendela runtime)
    assets/tray.png   (32x32, ikon tray)
    assets/tray-16.png(16x16, tray kecil)
"""
import argparse
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="/home/chris/Documents/Aplikasi/pos_amd/pos_amd_portal/portal/public/icons/icon-512.png",
        help="Berkas logo sumber (PNG persegi, minimal 256x256).",
    )
    args = parser.parse_args()

    img = Image.open(args.source).convert("RGBA").resize((512, 512), Image.LANCZOS)

    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)

    img.save(os.path.join(ROOT, "build", "icon.png"))
    img.resize((256, 256), Image.LANCZOS).save(
        os.path.join(ROOT, "build", "icon.ico"), format="ICO", sizes=ICO_SIZES
    )

    img.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "assets", "icon.png"))
    img.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, "assets", "tray.png"))
    img.resize((16, 16), Image.LANCZOS).save(os.path.join(ROOT, "assets", "tray-16.png"))

    print("Ikon diperbarui di build/ dan assets/.")


if __name__ == "__main__":
    main()
