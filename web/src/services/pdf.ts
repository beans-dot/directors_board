import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { visualRatioToStored } from '../domain/coords';
import type { GlyphRun } from '../domain/underline';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdfDocument(data: Uint8Array) {
  return pdfjs.getDocument({ data }).promise;
}

export async function glyphRunsOnPage(page: pdfjs.PDFPageProxy): Promise<GlyphRun[]> {
  const viewport = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const runs: GlyphRun[] = [];
  for (const item of text.items) {
    if (!('str' in item) || !item.str.trim() || item.width <= 0) continue;
    const height = item.height || Math.hypot(item.transform[2], item.transform[3]);
    if (height <= 0) continue;
    const [bx, by] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const [, topY] = viewport.convertToViewportPoint(item.transform[4], item.transform[5] + height);
    const [ex] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5]);
    const baseline = visualRatioToStored(page.rotate, bx / viewport.width, by / viewport.height);
    const top = visualRatioToStored(page.rotate, bx / viewport.width, topY / viewport.height);
    const end = visualRatioToStored(page.rotate, ex / viewport.width, by / viewport.height);
    const x = Math.min(baseline.x, end.x);
    const w = Math.abs(end.x - baseline.x);
    if (w < 0.001) continue;
    runs.push({ x, w, top: Math.min(top.y, baseline.y), baseline: baseline.y });
  }
  return runs;
}

export async function glyphRunsByPage(bytes: Uint8Array): Promise<GlyphRun[][]> {
  const doc = await openPdfDocument(bytes);
  try {
    const runs: GlyphRun[][] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      runs.push(await glyphRunsOnPage(await doc.getPage(number)));
    }
    return runs;
  } finally {
    await doc.destroy();
  }
}

export async function loadKoreanFont(): Promise<Uint8Array> {
  const cached = await caches.open('bojik-font').catch(() => null);
  const url = '/fonts/NanumGothic-Regular.ttf';
  if (cached) {
    const hit = await cached.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('한글 폰트 파일이 없습니다');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (cached) await cached.put(url, new Response(bytes));
  return bytes;
}
