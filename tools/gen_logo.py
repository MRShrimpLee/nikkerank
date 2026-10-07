# -*- coding: utf-8 -*-
"""生成站点图标（assets/logo/favicon.png 与 512x512.png）。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "logo")

BG = (12, 10, 16, 255)
ACCENT = (255, 77, 141, 255)
GOLD = (255, 209, 102, 255)


def font(size):
    for name in ("arialbd.ttf", "seguisb.ttf", "msyhbd.ttc", "arial.ttf"):
        path = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make(size):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = max(2, size // 16)
    d.rectangle([pad, pad, size - pad - 1, size - pad - 1], outline=ACCENT, width=max(2, size // 32))
    # 斜向条纹呼应妮姬 UI
    step = max(4, size // 12)
    for x in range(-size, size * 2, step * 2):
        d.line([(x, size - pad), (x + size - 2 * pad, pad)], fill=(255, 77, 141, 40), width=max(1, size // 64))
    f = font(int(size * 0.40))
    text = "NK"
    box = d.textbbox((0, 0), text, font=f)
    d.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1] - size * 0.05),
           text, font=f, fill=ACCENT)
    d.line([pad, size - pad, size - pad, size - pad], fill=GOLD, width=max(2, size // 40))
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    make(512).save(os.path.join(OUT_DIR, "512x512.png"))
    make(144).save(os.path.join(OUT_DIR, "144x144.png"))
    make(64).save(os.path.join(OUT_DIR, "favicon.png"))
    print("已生成:", ", ".join(sorted(os.listdir(OUT_DIR))))


if __name__ == "__main__":
    main()
