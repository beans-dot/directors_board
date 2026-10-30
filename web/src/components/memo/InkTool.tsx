import type { RatioPoint } from './HighlightTool';

export function smoothPath(points: RatioPoint[]): Array<[number, number]> {
  return points.map((point) => [Number(point.x.toFixed(4)), Number(point.y.toFixed(4))]);
}
