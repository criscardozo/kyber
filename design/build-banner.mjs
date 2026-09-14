#!/usr/bin/env node
// Builds banner.png, the image the README opens with.
//
// It is GENERATED, and from icon.svg, because the alternative is a second
// drawing of the same mark that nothing keeps in step. A hand-traced banner
// would look identical the day it is made and drift the first time the crystal
// changes.
//
// Three things this had to be careful about, each learned by getting it wrong
// somewhere in these projects:
//
//   1. The word is rasterised here, not left as SVG <text>. GitHub serves an
//      SVG as an image and never loads a webfont, so text that stays text is
//      drawn with whatever the reader happens to have installed.
//   2. The face is named by FILE and the result is looked at. A font
//      collection or a variable font renders its default instance, which is
//      not necessarily the weight anybody wanted — Thin, in one case.
//   3. The banner carries its own background. Composited over both GitHub
//      themes, a transparent one loses the word on dark. One opaque field
//      works on both with a single file; anything else needs two files and a
//      <picture> with prefers-color-scheme.
//
// And it positions by MEASURED ink, never by the nominal box: the crystal's
// outline is a stroke with a round join, so the drawing reaches past the
// viewBox edge it would be placed from. Every inset can be honoured exactly
// and still look wrong if one of them is measured against the wrong edge.
//
// Usage: node design/build-banner.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "banner.png");

// 2x, so the 360 px the README asks for stays crisp on a retina screen.
const SCALE = 2;
const W = 720 * SCALE;
const H = 200 * SCALE;
const FIELD = "#0E2233";      // its own field: see note 3 above
const INK = "#EAF6FC";
const FONT = "/System/Library/Fonts/Avenir Next.ttc";
const WORD = "Kyber";

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

/** Where the ink actually is in a PNG: [w, h, xOffset, yOffset]. */
function inkBox(file) {
  const out = run("magick", [file, "-trim", "-format", "%w %h %X %Y", "info:"]);
  return out.trim().split(/\s+/).map((n) => Number(n.replace("+", "")));
}

const tmp = mkdtempSync(join(tmpdir(), "kyber-banner-"));
try {
  // 1. The mark, from the one file that defines it.
  const crystal = join(tmp, "crystal.png");
  run("rsvg-convert", ["-h", String(140 * SCALE), join(ROOT, "icon.svg"), "-o", crystal]);
  const cropped = join(tmp, "crystal-trim.png");
  run("magick", [crystal, "-trim", "+repage", cropped]);
  const [cw, ch] = inkBox(crystal);

  // 2. The word, rasterised with a named face.
  const word = join(tmp, "word.png");
  run("magick", [
    "-background", "none", "-fill", INK, "-font", FONT,
    "-pointsize", String(86 * SCALE), "-kerning", String(2 * SCALE),
    `label:${WORD}`, "-trim", "+repage", word,
  ]);
  const [ww, wh] = inkBox(word);

  // 3. Lay them out from the measured ink, centred as one block.
  const gap = 34 * SCALE;
  const blockW = cw + gap + ww;
  const x0 = Math.round((W - blockW) / 2);
  const cy = Math.round((H - ch) / 2);
  // Optical centring: a cap-height word sits slightly low against a symmetric
  // shape if both are centred on the same axis.
  const wy = Math.round((H - wh) / 2) - Math.round(2 * SCALE);

  const radius = 28 * SCALE;
  const mask = join(tmp, "mask.png");
  const field = join(tmp, "field.png");

  // The card shape, kept as its own mask. Building the glow on the card and
  // blurring the lot softened the corners into a grey fringe: the blur has to
  // happen on its own layer and be clipped back to the shape, not applied to
  // the shape.
  run("magick", ["-size", `${W}x${H}`, "xc:black", "-fill", "white",
    "-draw", `roundrectangle 0,0 ${W - 1},${H - 1} ${radius},${radius}`, mask]);

  // Field plus a soft light behind the mark, blurred before it is clipped.
  run("magick", ["-size", `${W}x${H}`, `xc:${FIELD}`,
    "(", "-size", `${W}x${H}`, "xc:none", "-fill", "#2C7FB5",
    "-draw", `circle ${x0 + cw / 2},${H / 2} ${x0 + cw / 2},${H / 2 - 76 * SCALE}`,
    "-blur", `0x${52 * SCALE}`, ")", "-compose", "over", "-composite", field]);

  run("magick", [
    field,
    "(", cropped, ")", "-geometry", `+${x0}+${cy}`, "-composite",
    "(", word, ")", "-geometry", `+${x0 + cw + gap}+${wy}`, "-composite",
    "(", mask, ")", "-alpha", "off", "-compose", "CopyOpacity", "-composite",
    // 8 bits per channel and no metadata: ImageMagick defaults to 16-bit here,
    // which quadrupled the file for a gradient nobody can see the difference in.
    "-depth", "8", "-strip",
    OUT,
  ]);
  console.log(`banner.png  ${W}x${H}  mark ${cw}x${ch}  word ${ww}x${wh}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
