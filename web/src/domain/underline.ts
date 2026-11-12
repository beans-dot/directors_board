export interface RatioPoint {
  x: number;
  y: number;
}

export interface UnderlineLine {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One stroke stays one line, from the press to the release. */
export function placeUnderline(start: RatioPoint, end: RatioPoint): UnderlineLine {
  return {
    x: start.x,
    y: start.y,
    w: end.x - start.x,
    h: end.y - start.y,
  };
}
