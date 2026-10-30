export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPoint {
  x: number;
  y: number;
}

export function normalizeRotate(rotate: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(rotate) % 360) + 360) % 360;
  if (r === 90 || r === 180 || r === 270) return r;
  return 0;
}

/** Displayed page ratio (top-left) to rotation-0 stored ratio. */
export function visualRatioToStored(rotate: number, vx: number, vy: number): PdfPoint {
  const r = normalizeRotate(rotate);
  if (r === 90) return { x: vy, y: 1 - vx };
  if (r === 180) return { x: 1 - vx, y: 1 - vy };
  if (r === 270) return { x: 1 - vy, y: vx };
  return { x: vx, y: vy };
}

export function storedRatioToVisual(rotate: number, x: number, y: number): PdfPoint {
  const r = normalizeRotate(rotate);
  if (r === 90) return { x: 1 - y, y: x };
  if (r === 180) return { x: 1 - x, y: 1 - y };
  if (r === 270) return { x: y, y: 1 - x };
  return { x, y };
}

/** Rotation-0 top-left ratio point to PDF user space (CropBox, y up). */
export function storedRatioToPdf(box: PdfBox, x: number, y: number): PdfPoint {
  return {
    x: box.x + x * box.width,
    y: box.y + (1 - y) * box.height,
  };
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rotation-0 top-left ratio rect to PDF user-space rect. */
export function storedRectToPdf(box: PdfBox, x: number, y: number, w: number, h: number): PdfRect {
  return {
    x: box.x + x * box.width,
    y: box.y + (1 - y - h) * box.height,
    width: w * box.width,
    height: h * box.height,
  };
}
