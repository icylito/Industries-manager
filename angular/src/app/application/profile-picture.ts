// The image work behind a profile picture: a square crop small enough to keep, and the two colours that stand out
// most in it, for the card's background. dominantColors is plain arithmetic on pixels, so it can be tested; the
// other two need a real browser's canvas.

export const PICTURE_SIZE = 256;
const MAX_BYTES = 300 * 1024;

// The two most noticeable colours: the most common colour buckets, weighted towards colourful ones so a white or
// grey backdrop doesn't win over the person, the second one far enough from the first to make a gradient.
// pixels is RGBA, as a canvas gives it. Null when nothing is opaque.
export function dominantColors(pixels: Uint8ClampedArray): [string, string] | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) return null;
  const colors = [...buckets.values()]
    .map((b) => {
      const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
      const max = Math.max(...rgb),
        min = Math.min(...rgb);
      const saturation = max === 0 ? 0 : (max - min) / max;
      return { rgb, score: b.n * (0.35 + saturation) };
    })
    .sort((a, b) => b.score - a.score);
  const first = colors[0].rgb;
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // A picture of one colour still gets a gradient: a darker shade of it
  const second =
    colors.slice(1).find((c) => distance(c.rgb, first) > 70)?.rgb ?? first.map((v) => v * 0.6);
  const css = (rgb: number[]) => `rgb(${rgb.map((v) => Math.round(v)).join(' ')})`;
  return [css(first), css(second)];
}

// The middle square of a picture, shrunk to PICTURE_SIZE, as WebP (JPEG where the browser can't make WebP)
export async function squarePicture(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file);
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PICTURE_SIZE;
  canvas
    .getContext('2d')!
    .drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      PICTURE_SIZE,
      PICTURE_SIZE,
    );
  image.close();
  const make = (type: string, quality: number) =>
    new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
  let blob = await make('image/webp', 0.86);
  if (!blob || blob.type !== 'image/webp' || blob.size > MAX_BYTES)
    blob = await make('image/jpeg', 0.82);
  if (!blob) throw new Error("This picture couldn't be read");
  return blob;
}

// The two colours of a picture, read from a small copy of it
export async function colorsOf(picture: Blob): Promise<[string, string] | null> {
  const image = await createImageBitmap(picture);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 40;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 40, 40);
  image.close();
  return dominantColors(context.getImageData(0, 0, 40, 40).data);
}
