export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Positive delta zooms out, the same direction as the browser's Ctrl+wheel. */
export function zoomFromWheel(zoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(zoom);
  const next = zoom * Math.exp(-deltaY * 0.002);
  return clampZoom(Math.round(next * 1000) / 1000);
}

export function wheelDeltaPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 400;
  return deltaY;
}
