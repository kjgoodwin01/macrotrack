from PIL import Image, ImageDraw

BRAND = (43, 138, 224)   # #2B8AE0
WHITE = (255, 255, 255)

def make_icon(size, path):
    s = size / 512
    img = Image.new("RGB", (size, size), WHITE)
    d   = ImageDraw.Draw(img)

    # ── Blue M ────────────────────────────────────────────────────────────────
    # Outer legs: x=68–160 (left) and x=352–444 (right), each 92px wide
    # Top y=82, bottom y=434, outer-V tip (256,282), inner diag ends (160,216)(352,216)
    m = [
        (68,  434), (68,  82),  (160, 82),  (256, 282),
        (352, 82),  (444, 82),  (444, 434), (352, 434),
        (352, 216), (256, 375), (160, 216), (160, 434),
    ]
    d.polygon([(x * s, y * s) for x, y in m], fill=BRAND)

    # ── Dumbbell geometry (coordinates at 512px scale) ────────────────────────
    #
    # Bar passes through the outer-V tip (y=282). Center bar on y=278 so the
    # V tip falls within the bar's height — the bar visually "threads" the V.
    #
    # Plates are narrower than the legs and centered within each outer leg.
    # Left leg center  x = (68+160)/2 = 114
    # Right leg center x = (352+444)/2 = 398
    #
    # Plate width = 56px  (vs. 92px leg width — clearly inset)
    # Plate height = 112px
    # Bar height  = 22px
    # Tab extension past M side = 30px

    bar_cy  = 278
    bar_h   = 22
    bar_t   = bar_cy - bar_h // 2   # 267
    bar_b   = bar_cy + bar_h // 2   # 289

    pw      = 56                    # plate width
    ph      = 112                   # plate height
    plate_t = bar_cy - ph // 2      # 222
    plate_b = bar_cy + ph // 2      # 334

    lp_l = 114 - pw // 2            # 86   left plate left edge
    lp_r = 114 + pw // 2            # 142  left plate right edge
    rp_l = 398 - pw // 2            # 370  right plate left edge
    rp_r = 398 + pw // 2            # 426  right plate right edge

    ext  = 30                       # tab extension past M edge
    tab_l = 68 - ext                # 38   left tab outer edge
    tab_r = 444 + ext               # 474  right tab outer edge

    def r(v): return int(v * s)

    # ── White bar (x=68→444, passes through V tip at y=282) ──────────────────
    d.rectangle([r(68), r(bar_t), r(444), r(bar_b)], fill=WHITE)

    # ── White plates (inside M outer legs) ───────────────────────────────────
    d.rectangle([r(lp_l), r(plate_t), r(lp_r), r(plate_b)], fill=WHITE)
    d.rectangle([r(rp_l), r(plate_t), r(rp_r), r(plate_b)], fill=WHITE)

    # ── Blue tabs (extends past M sides — same color as M so they read as
    #    the dumbbell continuing outside the M in the same material) ──────────
    d.rectangle([r(tab_l), r(plate_t), r(68),  r(plate_b)], fill=BRAND)  # left tab
    d.rectangle([r(444),   r(plate_t), r(tab_r), r(plate_b)], fill=BRAND) # right tab
    # Thin bar tabs at same x range
    d.rectangle([r(tab_l), r(bar_t),   r(68),   r(bar_b)],   fill=BRAND)
    d.rectangle([r(444),   r(bar_t),   r(tab_r), r(bar_b)],  fill=BRAND)

    img.save(path, "PNG", optimize=True)
    print(f"Saved {path} ({size}x{size})")

make_icon(1024, "C:/repos/macrotrack/icon-1024.png")
make_icon(512,  "C:/repos/macrotrack/icon-512.png")
make_icon(192,  "C:/repos/macrotrack/icon-192.png")
print("Done.")
