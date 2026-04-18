from PIL import Image, ImageDraw

BRAND = (43, 138, 224)   # #2B8AE0  brand primary blue
WHITE = (255, 255, 255)

def rounded_rect_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=255)
    return mask

def make_icon(size, out_path):
    s = size / 512

    img = Image.new("RGBA", (size, size), BRAND + (255,))
    d = ImageDraw.Draw(img)

    # ── White block M ────────────────────────────────────────────────────────
    # Bold M with vertical outer legs and a flat baseline.
    # Stroke width ≈ 92px. Valley dips to y=290 (outer), inner valley y=370.
    m = [
        (68,  430),   # bottom-left outer
        (68,  88),    # top-left outer
        (160, 88),    # top edge of left leg / diagonal start
        (256, 285),   # outer valley (top of V)
        (352, 88),    # top edge of right leg / diagonal start
        (444, 88),    # top-right outer
        (444, 430),   # bottom-right outer
        (352, 430),   # bottom-right inner
        (352, 218),   # inner-right diagonal end
        (256, 375),   # inner valley
        (160, 218),   # inner-left diagonal end
        (160, 430),   # bottom-left inner
    ]
    m_scaled = [(x * s, y * s) for x, y in m]
    d.polygon(m_scaled, fill=WHITE)

    # ── Dumbbell carved out (background colour painted back over the M) ────
    # Dumbbell center sits at y=259 (mid-height of M legs: (88+430)/2 = 259).
    cy = 259

    # Plate dimensions  (over outer legs, taller than handle)
    plate_h  = 130   # total plate height
    plate_t  = int((cy - plate_h / 2) * s)
    plate_b  = int((cy + plate_h / 2) * s)

    # Handle dimensions (thin bar connecting the plates across the full width)
    handle_h = 30
    handle_t = int((cy - handle_h / 2) * s)
    handle_b = int((cy + handle_h / 2) * s)

    # Left plate  — covers the full width of the left outer leg
    lp_l, lp_r = int(68 * s), int(160 * s)
    d.rectangle([lp_l, plate_t, lp_r, plate_b], fill=BRAND)

    # Right plate — covers the full width of the right outer leg
    rp_l, rp_r = int(352 * s), int(444 * s)
    d.rectangle([rp_l, plate_t, rp_r, plate_b], fill=BRAND)

    # Handle bar — runs full width between (and including) the plates
    d.rectangle([int(68 * s), handle_t, int(444 * s), handle_b], fill=BRAND)

    # ── iOS squircle rounded corners ─────────────────────────────────────────
    radius = int(size * 0.225)
    mask   = rounded_rect_mask(size, radius)
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(img, mask=mask)

    final = Image.new("RGB", (size, size), BRAND)
    final.paste(result, mask=result.split()[3])
    final.save(out_path, "PNG", optimize=True)
    print(f"Saved  {out_path}  ({size}×{size})")

make_icon(512, "C:/repos/macrotrack/icon-512.png")
make_icon(192, "C:/repos/macrotrack/icon-192.png")
print("Done.")
