import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Annotation } from '../api/types';
import { markHex } from './colors';
import { normalizeRotate, storedRatioToPdf, storedRatioToVisual, storedRectToPdf, type PdfBox, type PdfPoint } from './coords';
import { pinNumberMap } from './pinNumbers';

const BLUE = rgb(47 / 255, 111 / 255, 237 / 255);
const INK = rgb(0.13, 0.13, 0.13);
const WHITE = rgb(1, 1, 1);
const PAPER = rgb(0.965, 0.97, 0.976);
const RULE = rgb(0.77, 0.8, 0.84);

/** Extra width, in PDF points, added beside the page for memo text. */
export const MEMO_LANE_WIDTH = 216;
const LANE_PAD = 10;
const MEMO_SIZE = 9;
const MEMO_LINE = 13;
const MEMO_GAP = 8;
const LANE_HEAD = 22;
const MAX_MEMO_LINES = 8;

function colorOf(ann: Annotation) {
  const hex = markHex(ann.color).slice(1);
  const value = Number.parseInt(hex, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function cropBox(page: PDFPage): PdfBox {
  const box = page.getCropBox();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines.slice(0, maxLines);
}

export interface MemoSlot {
  key: string;
  /** 0 at the top of the page, 1 at the bottom. */
  visualY: number;
  height: number;
}

/** Stack memo boxes down the side lane, keeping each one near its pin. */
export function placeMemoSlots(
  slots: MemoSlot[],
  laneHeight: number,
  gap: number,
  start = 0,
): { placed: Array<{ key: string; top: number }>; overflow: string[] } {
  const sorted = slots.slice().sort((a, b) => a.visualY - b.visualY || a.key.localeCompare(b.key));
  const placed: Array<{ key: string; top: number }> = [];
  const overflow: string[] = [];
  let cursor = start;
  for (const slot of sorted) {
    const maxTop = laneHeight - slot.height;
    if (slot.height <= 0 || start > maxTop) {
      overflow.push(slot.key);
      continue;
    }
    const desired = slot.visualY * laneHeight - slot.height / 2;
    const aligned = Math.min(maxTop, Math.max(start, desired));
    const top = Math.max(aligned, cursor);
    if (top + slot.height > laneHeight + 0.01) {
      overflow.push(slot.key);
      continue;
    }
    placed.push({ key: slot.key, top });
    cursor = top + slot.height + gap;
  }
  return { placed, overflow };
}

type QuarterTurn = 0 | 90 | 180 | 270;

/** A point in the memo lane. localX grows into the lane, localY grows down the page. */
export function memoLanePoint(lane: PdfBox, angle: QuarterTurn, localX: number, localY: number): PdfPoint {
  if (angle === 0) return { x: lane.x + localX, y: lane.y + lane.height - localY };
  if (angle === 90) return { x: lane.x + localY, y: lane.y + localX };
  if (angle === 180) return { x: lane.x + lane.width - localX, y: lane.y + localY };
  return { x: lane.x + lane.width - localY, y: lane.y + lane.height - localX };
}

export async function flattenPdf(opts: {
  bytes: Uint8Array;
  fontBytes: Uint8Array | null;
  annotations: Annotation[];
}): Promise<{ bytes: Uint8Array; failed: boolean }> {
  const active = opts.annotations.filter((ann) => ann.status === 'active');
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(opts.bytes, { ignoreEncryption: true });
  } catch {
    return { bytes: opts.bytes, failed: true };
  }
  const needsFont = active.some((ann) => ann.content.trim() || ann.type === 'pin');
  if (needsFont && !opts.fontBytes) {
    throw new Error('한글 폰트 파일이 없습니다');
  }
  let font: PDFFont | null = null;
  if (needsFont && opts.fontBytes) {
    pdf.registerFontkit(fontkit);
    // Subsetting this font makes viewers space the syllables far apart.
    font = await pdf.embedFont(opts.fontBytes, { subset: false });
  }
  const pages = pdf.getPages();
  const overflow: string[] = [];
  const byPage = new Map<number, Annotation[]>();
  for (const ann of active) {
    const pageNo = Math.min(pages.length, Math.max(1, ann.page));
    const list = byPage.get(pageNo) || [];
    list.push(ann);
    byPage.set(pageNo, list);
  }
  for (const [pageNo, list] of byPage) {
    const page = pages[pageNo - 1];
    if (!page) continue;
    drawPageMarks(page, font, list, overflow);
  }
  if (font && overflow.length) paintOverflow(pdf, font, overflow);
  const out = await pdf.save();
  return { bytes: out, failed: false };
}

function paintOverflow(pdf: PDFDocument, font: PDFFont, items: string[]) {
  const summary = pdf.addPage();
  summary.drawText('메모 요약', { x: 48, y: summary.getHeight() - 64, size: 16, font, color: INK });
  let y = summary.getHeight() - 96;
  const width = summary.getWidth() - 96;
  for (const item of items) {
    for (const line of wrapText(item, font, 10, width, 40)) {
      if (y < 48) return;
      summary.drawText(line, { x: 48, y, size: 10, font, color: INK });
      y -= 15;
    }
    y -= 6;
  }
}

function drawPageMarks(
  page: PDFPage,
  font: PDFFont | null,
  list: Annotation[],
  overflow: string[],
) {
  const content = cropBox(page);
  const angle = normalizeRotate(page.getRotation().angle);
  for (const ann of list) {
    if (ann.type === 'highlight' || ann.type === 'underline') drawSpan(page, content, ann);
    else if (ann.type === 'ink') drawInk(page, content, ann);
  }
  const pins = list.filter((ann) => ann.type === 'pin');
  if (!pins.length || !font) return;
  const numbers = pinNumberMap(pins);
  const lane = addMemoLane(page, content, angle);
  for (const ann of pins) {
    const point = storedRatioToPdf(content, ann.x, ann.y);
    const label = String(numbers.get(ann.id) || '');
    page.drawCircle({ x: point.x, y: point.y, size: 8, color: BLUE });
    page.drawText(label, {
      x: point.x - (label.length > 1 ? 6 : 3),
      y: point.y - 3,
      size: 8,
      font,
      color: WHITE,
    });
  }
  drawLane(page, lane, angle, font, pins, numbers, overflow);
}

function drawSpan(page: PDFPage, box: PdfBox, ann: Annotation) {
  if (ann.type === 'highlight') {
    const rect = storedRectToPdf(box, ann.x, ann.y, Math.max(ann.w, 0.01), Math.max(ann.h, 0.004));
    page.drawRectangle({ ...rect, color: colorOf(ann), opacity: 0.35 });
    return;
  }
  const start = storedRatioToPdf(box, ann.x, ann.y);
  const end = storedRatioToPdf(box, ann.x + ann.w, ann.y + ann.h);
  page.drawLine({ start, end, thickness: 1.25, color: colorOf(ann) });
}

function drawInk(page: PDFPage, box: PdfBox, ann: Annotation) {
  for (const path of ann.inkPaths || []) {
    for (let i = 1; i < path.length; i++) {
      const a = storedRatioToPdf(box, path[i - 1][0], path[i - 1][1]);
      const b = storedRatioToPdf(box, path[i][0], path[i][1]);
      page.drawLine({ start: a, end: b, thickness: 1.4, color: colorOf(ann) });
    }
  }
}

function addMemoLane(page: PDFPage, content: PdfBox, angle: QuarterTurn): PdfBox {
  const lane = laneBox(content, angle, MEMO_LANE_WIDTH);
  const crop = growBox(content, angle, MEMO_LANE_WIDTH);
  const media = containBox(mediaBox(page), crop);
  page.setMediaBox(media.x, media.y, media.width, media.height);
  page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  page.drawRectangle({ x: lane.x, y: lane.y, width: lane.width, height: lane.height, color: PAPER });
  drawDivider(page, lane, angle);
  return lane;
}

function drawLane(
  page: PDFPage,
  lane: PdfBox,
  angle: QuarterTurn,
  font: PDFFont,
  pins: Annotation[],
  numbers: Map<string, number>,
  overflow: string[],
) {
  const title = memoLanePoint(lane, angle, LANE_PAD, 16);
  page.drawText('메모', { x: title.x, y: title.y, size: 10, font, color: INK, rotate: degrees(angle) });
  const textWidth = MEMO_LANE_WIDTH - LANE_PAD * 2 - 22;
  const cards = pins.map((ann) => {
    const number = numbers.get(ann.id) || 0;
    const body = ann.content.trim() || '(내용 없음)';
    const lines = wrapText(`${number}  ${body}`, font, MEMO_SIZE, textWidth, MAX_MEMO_LINES);
    const truncated = lines.join('') !== `${number}  ${body}`.replace(/\n/g, '');
    return { ann, number, body, lines, truncated, height: lines.length * MEMO_LINE + 10 };
  });
  const span = laneSpan(lane, angle);
  const layout = placeMemoSlots(
    cards.map((card) => ({
      key: card.ann.id,
      visualY: storedRatioToVisual(angle, card.ann.x, card.ann.y).y,
      height: card.height,
    })),
    span,
    MEMO_GAP,
    LANE_HEAD,
  );
  const placed = new Map(layout.placed.map((slot) => [slot.key, slot.top]));
  for (const card of cards) {
    const top = placed.get(card.ann.id);
    if (top === undefined || card.truncated) {
      overflow.push(`${card.number}. ${card.body}`);
    }
    if (top === undefined) continue;
    const rect = memoCardRect(lane, angle, top, card.height);
    page.drawRectangle({ ...rect, color: WHITE, borderColor: BLUE, borderWidth: 0.7 });
    card.lines.forEach((line, i) => {
      const point = memoLanePoint(lane, angle, LANE_PAD + 6, top + 12 + i * MEMO_LINE);
      page.drawText(line, { x: point.x, y: point.y, size: MEMO_SIZE, font, color: INK, rotate: degrees(angle) });
    });
  }
}

function memoCardRect(lane: PdfBox, angle: QuarterTurn, top: number, height: number): PdfBox {
  const inset = LANE_PAD;
  if (angle === 0) {
    return { x: lane.x + inset, y: lane.y + lane.height - top - height, width: lane.width - inset * 2, height };
  }
  if (angle === 90) {
    return { x: lane.x + top, y: lane.y + inset, width: height, height: lane.height - inset * 2 };
  }
  if (angle === 180) {
    return { x: lane.x + inset, y: lane.y + top, width: lane.width - inset * 2, height };
  }
  return { x: lane.x + lane.width - top - height, y: lane.y + inset, width: height, height: lane.height - inset * 2 };
}

function laneBox(content: PdfBox, angle: QuarterTurn, column: number): PdfBox {
  if (angle === 0) return { x: content.x + content.width, y: content.y, width: column, height: content.height };
  if (angle === 90) return { x: content.x, y: content.y + content.height, width: content.width, height: column };
  if (angle === 180) return { x: content.x - column, y: content.y, width: column, height: content.height };
  return { x: content.x, y: content.y - column, width: content.width, height: column };
}

function growBox(box: PdfBox, angle: QuarterTurn, column: number): PdfBox {
  if (angle === 0) return { ...box, width: box.width + column };
  if (angle === 90) return { ...box, height: box.height + column };
  if (angle === 180) return { x: box.x - column, y: box.y, width: box.width + column, height: box.height };
  return { x: box.x, y: box.y - column, width: box.width, height: box.height + column };
}

function containBox(outer: PdfBox, inner: PdfBox): PdfBox {
  const x = Math.min(outer.x, inner.x);
  const y = Math.min(outer.y, inner.y);
  return {
    x,
    y,
    width: Math.max(outer.x + outer.width, inner.x + inner.width) - x,
    height: Math.max(outer.y + outer.height, inner.y + inner.height) - y,
  };
}

function mediaBox(page: PDFPage): PdfBox {
  const box = page.getMediaBox();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function laneSpan(lane: PdfBox, angle: QuarterTurn): number {
  return angle === 90 || angle === 270 ? lane.width : lane.height;
}

function drawDivider(page: PDFPage, lane: PdfBox, angle: QuarterTurn) {
  const edge =
    angle === 0
      ? { start: { x: lane.x, y: lane.y }, end: { x: lane.x, y: lane.y + lane.height } }
      : angle === 90
        ? { start: { x: lane.x, y: lane.y }, end: { x: lane.x + lane.width, y: lane.y } }
        : angle === 180
          ? { start: { x: lane.x + lane.width, y: lane.y }, end: { x: lane.x + lane.width, y: lane.y + lane.height } }
          : { start: { x: lane.x, y: lane.y + lane.height }, end: { x: lane.x + lane.width, y: lane.y + lane.height } };
  page.drawLine({ ...edge, thickness: 0.8, color: RULE });
}
