export interface FindRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FindHit {
  page: number;
  rects: FindRect[];
}

export interface FindTextItem {
  str: string;
  hasEOL?: boolean;
  dir?: string;
  transform: number[];
  width: number;
  height: number;
}

export interface FindViewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): ArrayLike<number>;
}

export function nextFindIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta < 0 ? count - 1 : 0;
  return (current + delta + count) % count;
}

export function findTextHits(items: FindTextItem[], viewport: FindViewport, page: number, query: string): FindHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const pieces: Array<{ item: FindTextItem; start: number; end: number }> = [];
  let text = '';
  for (const item of items) {
    if (!item.str) continue;
    const start = text.length;
    text += item.str;
    pieces.push({ item, start, end: text.length });
    if (item.hasEOL) text += '\n';
  }
  const { lower, map } = expandLower(text);
  const hits: FindHit[] = [];
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    const endLower = at + needle.length - 1;
    if (endLower >= map.length) break;
    const rects = rectsForRange(pieces, viewport, map[at], map[endLower] + 1);
    if (rects.length) hits.push({ page, rects });
    from = at + needle.length;
  }
  return hits;
}

function expandLower(text: string): { lower: string; map: number[] } {
  let lower = '';
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const part = text[index].toLowerCase();
    for (let offset = 0; offset < part.length; offset += 1) {
      lower += part[offset];
      map.push(index);
    }
  }
  return { lower, map };
}

function rectsForRange(
  pieces: Array<{ item: FindTextItem; start: number; end: number }>,
  viewport: FindViewport,
  start: number,
  end: number,
): FindRect[] {
  const rects: FindRect[] = [];
  for (const piece of pieces) {
    const overlapStart = Math.max(start, piece.start);
    const overlapEnd = Math.min(end, piece.end);
    if (overlapStart >= overlapEnd) continue;
    const rect = rectForSlice(piece.item, overlapStart - piece.start, overlapEnd - piece.start, viewport);
    if (rect) rects.push(rect);
  }
  return rects;
}

function rectForSlice(item: FindTextItem, localStart: number, localEnd: number, viewport: FindViewport): FindRect | null {
  const length = item.str.length || 1;
  if (item.dir === 'ttb') return itemBounds(item, viewport, 0, 1);
  let startFrac = localStart / length;
  let endFrac = localEnd / length;
  if (item.dir === 'rtl') {
    startFrac = 1 - localEnd / length;
    endFrac = 1 - localStart / length;
  }
  return itemBounds(item, viewport, startFrac, endFrac);
}

function itemBounds(item: FindTextItem, viewport: FindViewport, startFrac: number, endFrac: number): FindRect | null {
  if (item.transform.length < 6 || item.width === 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const height = item.height || Math.hypot(item.transform[2] || 0, item.transform[3] || 0);
  if (height <= 0) return null;
  const x0 = item.transform[4] + item.width * startFrac;
  const x1 = item.transform[4] + item.width * endFrac;
  const y0 = item.transform[5];
  const y1 = item.transform[5] + height;
  const p0 = viewport.convertToViewportPoint(x0, y0);
  const p1 = viewport.convertToViewportPoint(x1, y1);
  const left = Math.min(p0[0], p1[0]);
  const top = Math.min(p0[1], p1[1]);
  const width = Math.abs(p1[0] - p0[0]);
  const boxHeight = Math.abs(p1[1] - p0[1]);
  if (width <= 0 || boxHeight <= 0) return null;
  return {
    x: left / viewport.width,
    y: top / viewport.height,
    w: width / viewport.width,
    h: boxHeight / viewport.height,
  };
}
