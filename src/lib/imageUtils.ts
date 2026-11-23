const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

export async function compressImageFileToDataUrl(
  file: File,
  options: { maxDimension?: number; preferPng?: boolean; quality?: number } = {}
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Please upload a PNG, JPG, WebP, or SVG image file.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image file must be under 5 MB.');
  }

  // Keep lightweight SVGs directly as base64 data URLs without rasterizing
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    if (text.length > 250_000) {
      throw new Error('SVG file is too large (max 250 KB).');
    }
    const base64 = btoa(unescape(encodeURIComponent(text)));
    return `data:image/svg+xml;base64,${base64}`;
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image file.'));
    el.src = rawDataUrl;
  });

  const maxDim = options.maxDimension ?? 640;
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return rawDataUrl;
  }
  ctx.drawImage(img, 0, 0, width, height);

  const mime = options.preferPng || file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const quality = options.quality ?? 0.84;
  return canvas.toDataURL(mime, quality);
}
