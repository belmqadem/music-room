// Generates the app's icon files from the logo (assets/images/logo.png).
//
//   node scripts/generate-icons.mjs        (or `make icons`)
//
// The logo is a mockup: the icon tile, with its own rounded corners and shadow, on black. The
// systems cut their own shape from a full square, so the files are rebuilt from it:
//   icon.png                     1024, the tile full bleed (iOS, and the legacy Android icon)
//   favicon.png                  48, the same (web)
//   android-icon-background.png  the tile's color, #0D0E16 (the surface-lowest token)
//   android-icon-foreground.png  the rings alone on transparent, inside the 66dp safe zone
//   android-icon-monochrome.png  the rings in white (themed icons)
//   splash-icon.png              the rings alone, over the splash's own background
//   brand-mark.png               144, the tile with rounded corners on transparent: the logo in the
//                                app's own header (shown at 36dp, so 4x)
// The numbers below (where the tile is, how far the rings reach) are measured on this logo: a
// different logo needs them measured again. Run it, then check the files before committing.
// It uses jimp-compact, which comes with Expo's own image tools (@expo/image-utils); it is not a
// direct dependency of the app, and nothing at run time uses it.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");
const Jimp = createRequire(import.meta.url)("jimp-compact");
const TILE = { r: 13, g: 14, b: 22 }; // #0D0E16, the tile's own color (surface-lowest)
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const IN = join(MOBILE, "assets/images/logo.png");
const OUT = join(MOBILE, "assets/images");

(async () => {
  const logo = await Jimp.read(IN);
  // The tile is x 215..1032, y 190..1001: a square just inside its border, centred on it.
  const side = 800,
    cx = 624,
    cy = 596;
  const tile = logo.clone().crop(cx - side / 2, cy - side / 2, side, side);
  // Outside the tile's rounded corners is black (and its shadow): fill it with the tile color.
  const radius = 160;
  tile.scan(0, 0, side, side, function (x, y, i) {
    const dx = x < radius ? radius - x : x >= side - radius ? x - (side - radius - 1) : 0;
    const dy = y < radius ? radius - y : y >= side - radius ? y - (side - radius - 1) : 0;
    if (dx && dy && Math.hypot(dx, dy) > radius - 30) {
      const d = this.bitmap.data;
      if (lum(d[i], d[i + 1], d[i + 2]) < 12) {
        d[i] = TILE.r;
        d[i + 1] = TILE.g;
        d[i + 2] = TILE.b;
      }
    }
  });
  const fill = (w, h) => new Jimp(w, h, Jimp.rgbaToInt(TILE.r, TILE.g, TILE.b, 255));

  // iOS and the legacy icon: full bleed, the system rounds the corners.
  await tile
    .clone()
    .resize(1024, 1024, Jimp.RESIZE_BICUBIC)
    .writeAsync(`${OUT}/icon.png`);
  await tile.clone().resize(48, 48, Jimp.RESIZE_BICUBIC).writeAsync(`${OUT}/favicon.png`);

  // The mark inside the app: the tile with its corners rounded (22%, like an app icon), the rest
  // transparent, so it sits on any surface.
  const mark = tile.clone().resize(144, 144, Jimp.RESIZE_BICUBIC);
  const markRadius = 144 * 0.22;
  mark.scan(0, 0, 144, 144, function (x, y, i) {
    const dx = Math.max(0, markRadius - x - 0.5, x + 0.5 - (144 - markRadius));
    const dy = Math.max(0, markRadius - y - 0.5, y + 0.5 - (144 - markRadius));
    const outside = Math.hypot(dx, dy) - markRadius;
    if (outside > 0) this.bitmap.data[i + 3] = Math.round(255 * Math.max(0, 1 - outside));
  });
  await mark.writeAsync(`${OUT}/brand-mark.png`);

  // Android adaptive icon (108dp, the launcher shows at least the middle 66dp): the rings, about
  // 78% of the tile, must fit 61% of the layer, so the tile is drawn at 400 of 512.
  await fill(512, 512).writeAsync(`${OUT}/android-icon-background.png`);

  // The rings alone, from how much brighter than the tile each pixel is, inside a circle just
  // around them (the outer arcs reach 39% of the tile from its centre), so the tile's own faint
  // outline does not come along.
  const rings = (size, keepColor) => {
    const img = tile.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
    img.scan(0, 0, size, size, function (x, y, i) {
      const d = this.bitmap.data;
      const inside = Math.hypot(x - size / 2, y - size / 2) < size * 0.43;
      const a = inside
        ? Math.max(0, Math.min(1, (lum(d[i], d[i + 1], d[i + 2]) - 24) / 60))
        : 0;
      if (!keepColor) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
      }
      d[i + 3] = Math.round(a * 255);
    });
    return img;
  };
  // Foreground: the colored rings on transparent, over the plain background layer, so no edge of
  // the tile can show whatever shape the launcher cuts. The rings (78% of the drawn size) stay
  // inside the 66dp safe zone: 61% of the 108dp layer.
  const fg = new Jimp(512, 512, 0x00000000);
  fg.composite(rings(380, true), 66, 66);
  await fg.writeAsync(`${OUT}/android-icon-foreground.png`);

  // Monochrome (themed icons): white rings, same proportions (432 layer).
  const mono = new Jimp(432, 432, 0x00000000);
  mono.composite(rings(320, false), 56, 56);
  await mono.writeAsync(`${OUT}/android-icon-monochrome.png`);
  // Splash: the colored rings on transparent, over the splash's own dark background.
  await rings(600, true).writeAsync(`${OUT}/splash-icon.png`);
})();
