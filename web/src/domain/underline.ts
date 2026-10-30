export interface GlyphRun {
  x: number;
  w: number;
  top: number;
  baseline: number;
}

export interface UnderlineSpan {
  x: number;
  y: number;
  w: number;
}

export function placeUnderline(
  drag: { x: number; y: number; w: number; h: number },
  runs: GlyphRun[],
): UnderlineSpan[] {
  const dragTop = drag.y;
  const dragBottom = drag.y + drag.h;
  const hits = runs.filter((run) => {
    const xOverlap = drag.x < run.x + run.w && drag.x + Math.max(drag.w, 0.004) > run.x;
    const font = Math.max(0.008, run.baseline - run.top);
    const throughGlyphs = dragTop < run.baseline + font * 0.35 && dragBottom > run.top - font * 0.35;
    return xOverlap && throughGlyphs;
  });
  if (!hits.length) {
    return [{ x: drag.x, y: Math.min(0.995, dragBottom), w: Math.max(drag.w, 0.008) }];
  }
  const groups: GlyphRun[][] = [];
  for (const run of [...hits].sort((a, b) => a.baseline - b.baseline)) {
    const group = groups.find((items) => Math.abs(items[0].baseline - run.baseline) < 0.006);
    if (group) group.push(run);
    else groups.push([run]);
  }
  return groups.map((group) => {
    const baseline = Math.max(...group.map((run) => run.baseline));
    const font = Math.max(0.008, ...group.map((run) => run.baseline - run.top));
    return {
      x: drag.x,
      y: Math.min(0.995, baseline + font * 0.45),
      w: Math.max(drag.w, 0.008),
    };
  });
}
