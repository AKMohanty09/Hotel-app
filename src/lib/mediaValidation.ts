export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

export interface ParsedDataImage {
  mimeType: AllowedImageMime;
  base64Data: string;
}

export function validateAppImageUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const url = String(raw).trim();
  if (!url) return null;
  const ok =
    url.startsWith('/src/assets/') ||
    /^\/api\/media\/[a-zA-Z0-9_-]{4,64}$/.test(url) ||
    url.startsWith('data:image/png;base64,') ||
    url.startsWith('data:image/jpeg;base64,') ||
    url.startsWith('data:image/webp;base64,') ||
    url.startsWith('data:image/svg+xml;base64,') ||
    url.startsWith('https://');
  if (!ok || url.length > 900_000) return null;
  return url;
}

export function parseValidatedDataImage(raw: unknown): ParsedDataImage | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);
  if (!match) return null;
  const mimeType = match[1] as AllowedImageMime;
  const base64Data = match[2];
  if (base64Data.length > 900_000) return null;
  if (mimeType === 'image/svg+xml') {
    const svgText = Buffer.from(base64Data, 'base64').toString('utf8').toLowerCase();
    if (
      svgText.includes('<script') ||
      svgText.includes('<foreignobject') ||
      svgText.includes('javascript:') ||
      /\bon[a-z]+\s*=/.test(svgText)
    ) {
      return null;
    }
  }
  return { mimeType, base64Data };
}
