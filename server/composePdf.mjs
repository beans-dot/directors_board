import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { zipSync } from 'fflate';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const BLUE = rgb(47 / 255, 111 / 255, 237 / 255);
const INK = rgb(0.13, 0.13, 0.13);
const WHITE = rgb(1, 1, 1);
const PAPER = rgb(0.965, 0.97, 0.976);
const RULE = rgb(0.77, 0.8, 0.84);
const MEMO_LANE_WIDTH = 216;
const LANE_PAD = 10;
const MEMO_SIZE = 9;
const MEMO_LINE = 13;
const MEMO_GAP = 8;
const LANE_HEAD = 22;
const MAX_MEMO_LINES = 8;

let fontBytesCache = null;

export function fontPath() {
  return process.env.DEPTHM_FONT || path.join(serverDir, '..', 'web', 'public', 'fonts', 'NanumGothic-Regular.ttf');
}

export function loadFontBytes() {
  if (fontBytesCache) return fontBytesCache;
  const file = fontPath();
  if (!fs.existsSync(file)) return null;
  fontBytesCache = fs.readFileSync(file);
  return fontBytesCache;
}

function normalizeRotate(rotate) {
  const r = ((Math.round(rotate) % 360) + 360) % 360;
  if (r === 90 || r === 180 || r === 270) return r;
  return 0;
}

function storedRatioToVisual(rotate, x, y) {
  const r = normalizeRotate(rotate);
  if (r === 90) return { x: 1 - y, y: x };
  if (r === 180) return { x: 1 - x, y: 1 - y };
  if (r === 270) return { x: y, y: 1 - x };
  return { x, y };
}

function storedRatioToPdf(box, x, y) {
  return { x: box.x + x * box.width, y: box.y + (1 - y) * box.height };
}

function storedRectToPdf(box, x, y, w, h) {
  return { x: box.x + x * box.width, y: box.y + (1 - y - h) * box.height, width: w * box.width, height: h * box.height };
}

/** 화면의 색 이름. web/src/domain/colors.ts 와 같은 값이다. */
const MARK_HEX = {
  red: 'e03131',
  orange: 'f76707',
  yellow: 'f5c518',
  green: '2f9e44',
  blue: '2f6fed',
  indigo: '364fc7',
  violet: '9c36b5',
  black: '111111',
  white: 'ffffff',
};

function colorOf(ann) {
  const raw = String(ann.color || '').trim().toLowerCase();
  const named = MARK_HEX[raw];
  const hex = named || raw.replace('#', '');
  const value = /^[0-9a-f]{6}$/.test(hex) ? Number.parseInt(hex, 16) : 0xf5c518;
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function wrapText(text, font, size, maxWidth, maxLines) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
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

function placeMemoSlots(slots, laneHeight, gap, start = 0) {
  const sorted = slots.slice().sort((a, b) => a.visualY - b.visualY || a.key.localeCompare(b.key));
  const placed = [];
  const overflow = [];
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

function memoLanePoint(lane, angle, localX, localY) {
  if (angle === 0) return { x: lane.x + localX, y: lane.y + lane.height - localY };
  if (angle === 90) return { x: lane.x + localY, y: lane.y + localX };
  if (angle === 180) return { x: lane.x + lane.width - localX, y: lane.y + localY };
  return { x: lane.x + lane.width - localY, y: lane.y + lane.height - localX };
}

function pinNumberMap(pins) {
  const ordered = pins
    .filter((ann) => ann.type === 'pin')
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  return new Map(ordered.map((ann, index) => [ann.id, index + 1]));
}

export async function composePdf(bytes, annotations) {
  const active = annotations.filter((ann) => ann.status === 'active');
  if (!active.length) return { bytes, failed: false };
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return { bytes, failed: true };
  }
  const needsFont = active.some((ann) => String(ann.content || '').trim() || ann.type === 'pin');
  const fontBytes = needsFont ? loadFontBytes() : null;
  if (needsFont && !fontBytes) {
    const error = new Error('한글 폰트 파일이 없습니다');
    error.status = 503;
    error.code = 'FONT_MISSING';
    throw error;
  }
  let font = null;
  if (fontBytes) {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(fontBytes, { subset: false });
  }
  const pages = pdf.getPages();
  const overflow = [];
  const byPage = new Map();
  for (const ann of active) {
    const pageNo = Math.min(pages.length, Math.max(1, Number(ann.page) || 1));
    const list = byPage.get(pageNo) || [];
    list.push(ann);
    byPage.set(pageNo, list);
  }
  for (const [pageNo, list] of byPage) {
    const page = pages[pageNo - 1];
    if (page) drawPageMarks(page, font, list, overflow);
  }
  if (font && overflow.length) paintOverflow(pdf, font, overflow);
  return { bytes: await pdf.save(), failed: false };
}

function paintOverflow(pdf, font, items) {
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

function cropBox(page) {
  const box = page.getCropBox();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function drawPageMarks(page, font, list, overflow) {
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
    page.drawText(label, { x: point.x - (label.length > 1 ? 6 : 3), y: point.y - 3, size: 8, font, color: WHITE });
  }
  drawLane(page, lane, angle, font, pins, numbers, overflow);
}

function drawSpan(page, box, ann) {
  if (ann.type === 'highlight') {
    const rect = storedRectToPdf(box, ann.x, ann.y, Math.max(ann.w, 0.01), Math.max(ann.h, 0.004));
    page.drawRectangle({ ...rect, color: colorOf(ann), opacity: 0.35 });
    return;
  }
  const start = storedRatioToPdf(box, ann.x, ann.y);
  const end = storedRatioToPdf(box, ann.x + ann.w, ann.y + ann.h);
  page.drawLine({ start, end, thickness: 1.25, color: colorOf(ann) });
}

function drawInk(page, box, ann) {
  const paths = Array.isArray(ann.inkPaths) ? ann.inkPaths : [];
  for (const ink of paths) {
    for (let i = 1; i < ink.length; i += 1) {
      const a = storedRatioToPdf(box, ink[i - 1][0], ink[i - 1][1]);
      const b = storedRatioToPdf(box, ink[i][0], ink[i][1]);
      page.drawLine({ start: a, end: b, thickness: 1.4, color: colorOf(ann) });
    }
  }
}

function laneBox(content, angle, column) {
  if (angle === 0) return { x: content.x + content.width, y: content.y, width: column, height: content.height };
  if (angle === 90) return { x: content.x, y: content.y + content.height, width: content.width, height: column };
  if (angle === 180) return { x: content.x - column, y: content.y, width: column, height: content.height };
  return { x: content.x, y: content.y - column, width: content.width, height: column };
}

function growBox(box, angle, column) {
  if (angle === 0) return { ...box, width: box.width + column };
  if (angle === 90) return { ...box, height: box.height + column };
  if (angle === 180) return { x: box.x - column, y: box.y, width: box.width + column, height: box.height };
  return { x: box.x, y: box.y - column, width: box.width, height: box.height + column };
}

function containBox(outer, inner) {
  const x = Math.min(outer.x, inner.x);
  const y = Math.min(outer.y, inner.y);
  return {
    x,
    y,
    width: Math.max(outer.x + outer.width, inner.x + inner.width) - x,
    height: Math.max(outer.y + outer.height, inner.y + inner.height) - y,
  };
}

function addMemoLane(page, content, angle) {
  const lane = laneBox(content, angle, MEMO_LANE_WIDTH);
  const crop = growBox(content, angle, MEMO_LANE_WIDTH);
  const mediaBox = page.getMediaBox();
  const media = containBox({ x: mediaBox.x, y: mediaBox.y, width: mediaBox.width, height: mediaBox.height }, crop);
  page.setMediaBox(media.x, media.y, media.width, media.height);
  page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  page.drawRectangle({ x: lane.x, y: lane.y, width: lane.width, height: lane.height, color: PAPER });
  const edge =
    angle === 0
      ? { start: { x: lane.x, y: lane.y }, end: { x: lane.x, y: lane.y + lane.height } }
      : angle === 90
        ? { start: { x: lane.x, y: lane.y }, end: { x: lane.x + lane.width, y: lane.y } }
        : angle === 180
          ? { start: { x: lane.x + lane.width, y: lane.y }, end: { x: lane.x + lane.width, y: lane.y + lane.height } }
          : { start: { x: lane.x, y: lane.y + lane.height }, end: { x: lane.x + lane.width, y: lane.y + lane.height } };
  page.drawLine({ ...edge, thickness: 0.8, color: RULE });
  return lane;
}

function memoCardRect(lane, angle, top, height) {
  const inset = LANE_PAD;
  if (angle === 0) return { x: lane.x + inset, y: lane.y + lane.height - top - height, width: lane.width - inset * 2, height };
  if (angle === 90) return { x: lane.x + top, y: lane.y + inset, width: height, height: lane.height - inset * 2 };
  if (angle === 180) return { x: lane.x + inset, y: lane.y + top, width: lane.width - inset * 2, height };
  return { x: lane.x + lane.width - top - height, y: lane.y + inset, width: height, height: lane.height - inset * 2 };
}

function drawLane(page, lane, angle, font, pins, numbers, overflow) {
  const title = memoLanePoint(lane, angle, LANE_PAD, 16);
  page.drawText('메모', { x: title.x, y: title.y, size: 10, font, color: INK, rotate: degrees(angle) });
  const textWidth = MEMO_LANE_WIDTH - LANE_PAD * 2 - 22;
  const cards = pins.map((ann) => {
    const number = numbers.get(ann.id) || 0;
    const body = String(ann.content || '').trim() || '(내용 없음)';
    const lines = wrapText(`${number}  ${body}`, font, MEMO_SIZE, textWidth, MAX_MEMO_LINES);
    const truncated = lines.join('') !== `${number}  ${body}`.replace(/\n/g, '');
    return { ann, number, body, lines, truncated, height: lines.length * MEMO_LINE + 10 };
  });
  const span = angle === 90 || angle === 270 ? lane.width : lane.height;
  const layout = placeMemoSlots(
    cards.map((card) => ({ key: card.ann.id, visualY: storedRatioToVisual(angle, card.ann.x, card.ann.y).y, height: card.height })),
    span,
    MEMO_GAP,
    LANE_HEAD,
  );
  const placed = new Map(layout.placed.map((slot) => [slot.key, slot.top]));
  for (const card of cards) {
    const top = placed.get(card.ann.id);
    if (top === undefined || card.truncated) overflow.push(`${card.number}. ${card.body}`);
    if (top === undefined) continue;
    page.drawRectangle({ ...memoCardRect(lane, angle, top, card.height), color: WHITE, borderColor: BLUE, borderWidth: 0.7 });
    card.lines.forEach((line, i) => {
      const point = memoLanePoint(lane, angle, LANE_PAD + 6, top + 12 + i * MEMO_LINE);
      page.drawText(line, { x: point.x, y: point.y, size: MEMO_SIZE, font, color: INK, rotate: degrees(angle) });
    });
  }
}

export function zipPdfs(entries) {
  const input = {};
  for (const entry of entries) input[entry.name] = entry.bytes;
  return zipSync(input, { level: 6 });
}

export function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
