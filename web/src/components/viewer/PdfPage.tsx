import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { GlyphRun } from '../../domain/underline';
import { glyphRunsOnPage } from '../../services/pdf';
import { MemoLayer } from '../memo/MemoLayer';
import { useViewer } from '../../state/viewer';
import { clearPageVisibility, markPageFromObserver, notePageVisibility, scrollFindHit } from './pageScroll';

export function PdfPage({ doc, pageNumber, scale }: { doc: PDFDocumentProxy; pageNumber: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewerPage = useViewer((state) => state.page);
  const findTick = useViewer((state) => state.findTick);
  const [near, setNear] = useState(Math.abs(pageNumber - useViewer.getState().page) <= 2);
  const visible = near || Math.abs(pageNumber - viewerPage) <= 1;
  const [box, setBox] = useState({ width: 0, height: 0, rotate: 0 });
  const [lines, setLines] = useState<GlyphRun[]>([]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const nearObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: '800px' });
    const pageObserver = new IntersectionObserver((entries) => {
      const hit = entries[0];
      if (!hit) return;
      const best = notePageVisibility(pageNumber, hit.isIntersecting ? hit.intersectionRect.height : 0);
      if (best && useViewer.getState().page !== best) {
        markPageFromObserver();
        useViewer.getState().patch({ page: best });
      }
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    nearObserver.observe(node);
    pageObserver.observe(node);
    return () => {
      nearObserver.disconnect();
      pageObserver.disconnect();
      clearPageVisibility(pageNumber);
    };
  }, [pageNumber]);

  useEffect(() => {
    if (!visible) return;
    let cancel = false;
    void (async () => {
      const page = await doc.getPage(pageNumber);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * ratio });
      const canvas = canvasRef.current;
      if (!canvas || cancel) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvasContext: context, viewport }).promise;
      const cssWidth = viewport.width / ratio;
      const cssHeight = viewport.height / ratio;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const runs = await glyphRunsOnPage(page);
      if (!cancel) {
        setBox({ width: cssWidth, height: cssHeight, rotate: page.rotate });
        setLines(runs);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [doc, pageNumber, scale, visible]);

  useEffect(() => {
    if (findTick === 0 || box.width <= 0) return;
    const { findIndex, findHits, findOpen } = useViewer.getState();
    const hit = findHits[findIndex];
    if (!findOpen || findIndex < 0 || !hit || hit.page !== pageNumber) return;
    const node = wrapRef.current?.querySelector('[data-find="current"]');
    if (!(node instanceof HTMLElement)) return;
    scrollFindHit(node);
  }, [findTick, box.width, box.height, pageNumber]);

  return (
    <div className="pdf-page" ref={wrapRef} id={`pdf-page-${pageNumber}`} style={{ width: box.width || '100%' }}>
      <canvas ref={canvasRef} />
      <FindMarks pageNumber={pageNumber} width={box.width} height={box.height} />
      {box.width > 0 && <MemoLayer page={pageNumber} rotate={box.rotate} width={box.width} height={box.height} lines={lines} />}
    </div>
  );
}

function FindMarks({ pageNumber, width, height }: { pageNumber: number; width: number; height: number }) {
  const open = useViewer((state) => state.findOpen);
  const hits = useViewer((state) => state.findHits);
  const index = useViewer((state) => state.findIndex);
  if (!open || width <= 0 || height <= 0) return null;
  return hits.map((hit, hitIndex) => {
    if (hit.page !== pageNumber) return null;
    const current = hitIndex === index;
    return hit.rects.map((rect, rectIndex) => (
      <div
        key={`${hitIndex}-${rectIndex}`}
        className={current ? 'find-hit on' : 'find-hit'}
        data-find={current && rectIndex === 0 ? 'current' : undefined}
        style={{
          left: `${rect.x * width}px`,
          top: `${rect.y * height}px`,
          width: `${rect.w * width}px`,
          height: `${rect.h * height}px`,
        }}
      />
    ));
  });
}
