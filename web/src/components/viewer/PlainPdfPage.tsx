import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { DriveNode } from '../../api/types';
import { MemoLayer } from '../memo/MemoLayer';

function renderWasCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

export function PlainPdfPage({
  doc,
  pageNumber,
  scale,
  activePage,
  pageId,
  onVisible,
  file,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  activePage: number;
  pageId: string;
  onVisible?: (pageNumber: number, height: number) => void;
  file?: DriveNode | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const visibleRef = useRef(onVisible);
  const [near, setNear] = useState(Math.abs(pageNumber - activePage) <= 2);
  const [box, setBox] = useState({ width: 0, height: 0, rotate: 0 });
  visibleRef.current = onVisible;

  useEffect(() => {
    if (Math.abs(pageNumber - activePage) <= 1) setNear(true);
  }, [activePage, pageNumber]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const nearObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '800px' },
    );
    const pageObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries[0];
        if (!hit) return;
        visibleRef.current?.(pageNumber, hit.isIntersecting ? hit.intersectionRect.height : 0);
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    nearObserver.observe(node);
    pageObserver.observe(node);
    return () => {
      nearObserver.disconnect();
      pageObserver.disconnect();
    };
  }, [pageNumber]);

  useEffect(() => {
    if (!near) return;
    let cancel = false;
    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancel) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * ratio });
      const cssWidth = viewport.width / ratio;
      const cssHeight = viewport.height / ratio;
      const canvas = canvasRef.current;
      if (!canvas || cancel) return;
      const previous = renderTaskRef.current;
      if (previous) {
        try {
          await previous.promise;
        } catch (error) {
          if (!renderWasCancelled(error) && !cancel) throw error;
        }
        if (renderTaskRef.current === previous) renderTaskRef.current = null;
      }
      if (cancel || canvasRef.current !== canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const context = canvas.getContext('2d');
      if (!context || cancel) return;
      setBox({ width: cssWidth, height: cssHeight, rotate: page.rotate });
      const task = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (error) {
        if (cancel || renderWasCancelled(error)) return;
        throw error;
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      }
    })();
    return () => {
      cancel = true;
      renderTaskRef.current?.cancel();
    };
  }, [doc, near, pageNumber, scale]);

  return (
    <div
      className="pdf-page"
      ref={wrapRef}
      id={pageId}
      style={box.width > 0 ? { width: box.width, height: box.height } : undefined}
    >
      {near && <canvas ref={canvasRef} />}
      {file && box.width > 0 && (
        <MemoLayer page={pageNumber} rotate={box.rotate} width={box.width} height={box.height} file={file} readOnly={false} />
      )}
    </div>
  );
}
