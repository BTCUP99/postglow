"""Draws the DMG window background (1x + 2x, combined into background.tiff).

Run on a Mac:  python3 src-tauri/dmg/make-background.py
Needs Pillow. Icon positions must match bundle.macOS.dmg in tauri.conf.json.
"""
import os, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 660, 440
APP, APPS, ICON_Y = (170, 150), (490, 150), 150
HERE = os.path.dirname(os.path.abspath(__file__))
CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"

INK, MUTED, ACCENT, BG = (28, 28, 40), (110, 110, 128), (91, 91, 214), (247, 247, 251)

STEPS = [
    "把 Postglow 拖到右边的「应用程序」",
    "在「应用程序」里双击 Postglow，出现提示时点「完成」",
    "打开「系统设置 → 隐私与安全性」，拉到最下面，点「仍要打开」",
]
NOTE = "应用尚未经过 Apple 公证，这几步只需做一次。"
NOTE_EN = "First launch: open once, then System Settings → Privacy & Security → Open Anyway."


def font(size, bold=False):
    return ImageFont.truetype(CJK, size, index=1 if bold else 0)


def draw(scale):
    s = lambda v: int(round(v * scale))
    im = Image.new("RGB", (s(W), s(H)), BG)

    # soft glow behind the two icons, echoing the app icon
    glow = Image.new("RGB", im.size, BG)
    g = ImageDraw.Draw(glow)
    g.ellipse([s(70), s(40), s(590), s(270)], fill=(232, 232, 250))
    im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(s(40))), 1.0)
    d = ImageDraw.Draw(im)

    # arrow from app to Applications
    y = s(ICON_Y)
    x0, x1 = s(APP[0] + 90), s(APPS[0] - 90)
    d.line([x0, y, x1 - s(10), y], fill=ACCENT, width=s(4))
    d.polygon([(x1, y), (x1 - s(16), y - s(10)), (x1 - s(16), y + s(10))], fill=ACCENT)

    # steps
    top = s(276)
    d.text((s(60), top), "第一次打开", font=font(s(15), True), fill=INK)
    for i, text in enumerate(STEPS):
        ty = top + s(30) + s(27) * i
        cx, cy, r = s(70), ty + s(9), s(9)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
        d.text((cx, cy), str(i + 1), font=font(s(11), True), fill="white", anchor="mm")
        d.text((s(88), ty), text, font=font(s(13)), fill=INK)
    d.text((s(60), s(396)), NOTE, font=font(s(11)), fill=MUTED)
    d.text((s(60), s(413)), NOTE_EN, font=font(s(10)), fill=MUTED)
    return im


p1, p2 = os.path.join(HERE, "bg.png"), os.path.join(HERE, "bg@2x.png")
draw(1).save(p1, dpi=(72, 72))
draw(2).save(p2, dpi=(144, 144))
subprocess.run(["tiffutil", "-cathidpicheck", p1, p2, "-out", os.path.join(HERE, "background.tiff")], check=True)
os.remove(p1); os.remove(p2)
print("wrote", os.path.join(HERE, "background.tiff"))
