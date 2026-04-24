type AccentAlbum = {
  title: string;
  artist: string;
  coverUrl?: string;
};

const accentCache = new Map<string, string>();

function seed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = h / 360;
  const sat = s / 100;
  const light = l / 100;
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const toRgb = (tRaw: number) => {
    let t = tRaw;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(toRgb(hue + 1 / 3) * 255),
    Math.round(toRgb(hue) * 255),
    Math.round(toRgb(hue - 1 / 3) * 255),
  ];
}

function liftRgb(r: number, g: number, b: number): string {
  const lift = 0.58;
  return [
    Math.round(r + (255 - r) * lift),
    Math.round(g + (255 - g) * lift),
    Math.round(b + (255 - b) * lift),
  ].join(" ");
}

export function getFallbackCoverAccent(targetAlbum: AccentAlbum | null | undefined): string {
  if (!targetAlbum) return "240 180 75";
  const base = `${targetAlbum.title}-${targetAlbum.artist}`;
  const hue = Math.round(18 + seed(base) * 205);
  const [r, g, b] = hslToRgb(hue, 48, 78);
  return `${r} ${g} ${b}`;
}

export function resolveCoverAccent(src: string): Promise<string | null> {
  const cached = accentCache.get(src);
  if (cached) return Promise.resolve(cached);
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 28;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const pixels = ctx.getImageData(0, 0, size, size).data;
        let totalWeight = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;

        for (let i = 0; i < pixels.length; i += 4) {
          const a = pixels[i + 3];
          if (a < 128) continue;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (luminance < 24 || luminance > 244) continue;
          const saturation = max === 0 ? 0 : (max - min) / max;
          const midtoneWeight = 1 - Math.min(1, Math.abs(luminance - 138) / 138);
          const weight = 0.35 + saturation * 1.45 + midtoneWeight * 0.45;
          totalWeight += weight;
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
        }

        if (totalWeight <= 0) {
          resolve(null);
          return;
        }

        const accent = liftRgb(
          rSum / totalWeight,
          gSum / totalWeight,
          bSum / totalWeight,
        );
        accentCache.set(src, accent);
        resolve(accent);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
