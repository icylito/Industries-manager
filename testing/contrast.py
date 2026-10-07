# WCAG contrast of the colour pairs the UI judge pointed at, read from styles.css. python3 -I contrast.py <styles.css>
import re, sys
css = open(sys.argv[1]).read()
def block(name):
    m = re.search(name + r"\s*\{([^}]*)\}", css, re.S)
    return dict(re.findall(r"--([\w-]+):\s*([^;]+);", m.group(1)))
light = block(r":root")
dark = block(r':root\[data-theme="dark"\]')
def rgb(v):
    v = v.strip()
    if v.startswith("#"):
        h = v[1:]; return tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) + (1.0,)
    m = re.match(r"rgba?\(([^)]*)\)", v); p = [float(x) for x in m.group(1).split(",")]
    return (p[0], p[1], p[2], p[3] if len(p) > 3 else 1.0)
def over(top, bottom):
    a = top[3]; return tuple(top[i] * a + bottom[i] * (1 - a) for i in range(3)) + (1.0,)
def lum(c):
    def ch(x):
        x /= 255; return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])
def ratio(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb); return (hi + 0.05) / (lo + 0.05)
for name, t in (("light", light), ("dark", dark)):
    bg, surface, text = rgb(t["bg"]), rgb(t["surface"]), rgb(t["text"])
    amber = over(rgb(t["similar-bg"]), bg)
    pairs = [
        ("--muted on --bg", rgb(t["muted"]), bg), ("--muted on --surface", rgb(t["muted"]), surface),
        ("--faint on --bg", rgb(t["faint"]), bg), ("--faint on --surface", rgb(t["faint"]), surface),
        ("--danger on --bg", rgb(t["danger"]), bg), ("--danger on amber row", rgb(t["danger"]), amber),
        ("--text on amber row", text, amber),
        ("disabled add-btn text (accent-text on muted)", rgb(t["accent-text"]), rgb(t["muted"])),
        ("disabled outline button text (muted on bg)", rgb(t["muted"]), bg),
    ]
    print(name)
    for label, a, b in pairs:
        r = ratio(a, b); print(f"  {label:62s} {r:5.2f}  {'ok' if r >= 4.5 else 'LOW'}")
