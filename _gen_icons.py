from PIL import Image, ImageDraw

BRAND = (26, 102, 179)   # #1A66B3
WHITE = (255, 255, 255)

def squircle_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=255)
    return mask

def make_icon(size, out_path):
    s = size / 512

    # ── Outer white squircle background ──────────────────────────────────────
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    outer_r = int(118 * s)
    d.rounded_rectangle([0, 0, size-1, size-1], radius=outer_r, fill=WHITE + (255,))

    # ── Inner blue squircle face (28px inset at 512) ──────────────────────────
    inset   = int(28 * s)
    inner_r = int(104 * s)
    d.rounded_rectangle(
        [inset, inset, size - inset - 1, size - inset - 1],
        radius=inner_r, fill=BRAND + (255,)
    )

    # ── White block M ─────────────────────────────────────────────────────────
    # Outer legs: x 68→160 (left) and 352→444 (right), width=92
    # Top y=82, bottom y=434, outer-V tip y=282, inner-V y=375, inner-diag y=216
    m = [
        (68,  434),
        (68,  82),
        (160, 82),
        (256, 282),
        (352, 82),
        (444, 82),
        (444, 434),
        (352, 434),
        (352, 216),
        (256, 375),
        (160, 216),
        (160, 434),
    ]
    d.polygon([(x * s, y * s) for x, y in m], fill=WHITE + (255,))

    # ── Dumbbell carve — blue rects painted back over the M ──────────────────
    # Vertical center of legs: (82+434)/2 = 258
    # Plates: h=132 → top=192  bottom=324
    # Handle: h=28  → top=244  bottom=272
    plate_t, plate_b = int(192 * s), int(324 * s)
    handle_t, handle_b = int(244 * s), int(272 * s)

    d.rectangle([int(68 * s),  plate_t,  int(160 * s), plate_b],  fill=BRAND + (255,))  # left plate
    d.rectangle([int(352 * s), plate_t,  int(444 * s), plate_b],  fill=BRAND + (255,))  # right plate
    d.rectangle([int(68 * s),  handle_t, int(444 * s), handle_b], fill=BRAND + (255,))  # handle

    # ── Composite onto white base (preserves white squircle border) ───────────
    final = Image.new("RGB", (size, size), WHITE)
    final.paste(img, mask=img.split()[3])
    final.save(out_path, "PNG", optimize=True)
    print(f"Saved  {out_path}  ({size}x{size})")

make_icon(512, "C:/repos/macrotrack/icon-512.png")
make_icon(192, "C:/repos/macrotrack/icon-192.png")
print("Done.")
