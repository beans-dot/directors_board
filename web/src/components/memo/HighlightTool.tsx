export interface RatioPoint {
  x: number;
  y: number;
}

export function rectFromDrag(start: RatioPoint, end: RatioPoint) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}
