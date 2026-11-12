import { useEffect, useRef, useState } from 'react';
import { closeSidePdf, openSidePdf } from '../../services/runtime';
import { useSplit } from '../../state/splitView';
import { fitTargetBox, pageFitZoom, type PageFit } from './fitZoom';
import { EmptyState } from '../common/EmptyState';
import { Spinner } from '../common/Spinner';
import { PdfTab } from './PdfTab';
import { ThumbnailRail } from './ThumbnailRail';
import { PlainPdfPage } from './PlainPdfPage';
import { useCtrlWheelZoom } from './useCtrlWheelZoom';
import { zoomFromWheel } from './wheelZoom';
import { usePdfDrop } from './usePdfDrop';

function pdfTitle(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

export function SplitPdfPane() {
  const file = useSplit((state) => state.file);
  const doc = useSplit((state) => state.doc);
  const page = useSplit((state) => state.page);
  const pageCount = useSplit((state) => state.pageCount);
  const zoom = useSplit((state) => state.zoom);
  const fit = useSplit((state) => state.fit);
  const thumbOpen = useSplit((state) => state.thumbOpen);
  const loading = useSplit((state) => state.loading);
  const scrollRef = useRef<HTMLDivElement>(null);
  const applyFitRef = useRef<() => Promise<void>>(async () => {});
  const heights = useRef(new Map<number, number>());
  const ignoreScrollUntil = useRef(0);
  const pendingScroll = useRef(false);
  const [fitDoc, setFitDoc] = useState<typeof doc>(null);
  const drop = usePdfDrop((node) => {
    void openSidePdf(node);
  });
  const ratio = useSplit((state) => state.ratio);
  const fitted = !doc || fit === 'custom' || fitDoc === doc;

  useCtrlWheelZoom(scrollRef, (deltaY) => {
    const current = useSplit.getState().zoom;
    const next = zoomFromWheel(current, deltaY);
    if (Math.abs(next - current) <= 0.0005) return;
    useSplit.getState().patch({ zoom: next, fit: 'custom' });
  });

  useEffect(() => {
    heights.current.clear();
    setFitDoc(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [doc]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !doc || (fit !== 'width' && fit !== 'height')) {
      if (doc) setFitDoc(doc);
      return;
    }
    let cancel = false;
    const apply = async () => {
      const state = useSplit.getState();
      if (!state.doc || (state.fit !== 'width' && state.fit !== 'height')) return;
      try {
        const pageNumber = Math.min(Math.max(1, state.page), state.doc.numPages);
        const pdfPage = await state.doc.getPage(pageNumber);
        if (cancel || useSplit.getState().doc !== state.doc || useSplit.getState().fit !== state.fit) return;
        const viewport = pdfPage.getViewport({ scale: 1 });
        const next = pageFitZoom({
          mode: state.fit,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
          pageCount: state.doc.numPages,
          ...fitTargetBox(scroller),
        });
        if (cancel || useSplit.getState().fit !== state.fit) return;
        if (next !== null && Math.abs(next - useSplit.getState().zoom) > 0.0005) {
          useSplit.getState().patch({ zoom: next });
        }
        setFitDoc(state.doc);
      } catch {
        if (!cancel && state.doc) setFitDoc(state.doc);
      }
    };
    applyFitRef.current = apply;
    void apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => void apply());
    observer?.observe(scroller);
    return () => {
      cancel = true;
      observer?.disconnect();
    };
  }, [doc, fit, page]);

  useEffect(() => {
    if (!pendingScroll.current) return;
    const node = document.getElementById(`side-pdf-page-${page}`);
    if (!node) return;
    if (typeof ResizeObserver === 'undefined') {
      node.scrollIntoView({ block: 'start' });
      pendingScroll.current = false;
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!pendingScroll.current || node.offsetHeight < 40) return;
      node.scrollIntoView({ block: 'start' });
      pendingScroll.current = false;
      observer.disconnect();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [page, zoom, doc, fitted]);

  const chooseFit = (mode: PageFit) => {
    pendingScroll.current = true;
    if (useSplit.getState().fit !== mode) useSplit.getState().patch({ fit: mode });
    else void applyFitRef.current();
  };

  const goToPage = (next: number) => {
    ignoreScrollUntil.current = Date.now() + 500;
    pendingScroll.current = true;
    useSplit.getState().patch({ page: next });
  };

  const onVisible = (pageNumber: number, height: number) => {
    if (height <= 0) heights.current.delete(pageNumber);
    else heights.current.set(pageNumber, height);
    if (Date.now() < ignoreScrollUntil.current) return;
    let best = 0;
    let bestPage = 0;
    for (const [number, visible] of heights.current) {
      if (visible > best) {
        best = visible;
        bestPage = number;
      }
    }
    if (best < 80 || bestPage === useSplit.getState().page) return;
    useSplit.getState().patch({ page: bestPage });
  };

  return (
    <section
      className={`split-pane${drop.over ? ' over' : ''}`}
      aria-label="오른쪽 PDF"
      style={{ flex: `${Math.max(0.2, 1 - ratio)} 1 0` }}
      {...drop.bind}
    >
      {doc && <ThumbnailRail doc={doc} page={page} open={thumbOpen} onPage={goToPage} />}
      <div className="pane-column">
        {file && (
          <PdfTab
            title={pdfTitle(file.name)}
            closeLabel="오른쪽 PDF 닫기"
            onClose={closeSidePdf}
            zoom={zoom}
            page={page}
            pageCount={pageCount}
            pageLabel="오른쪽 페이지"
            zoomLabel="오른쪽 확대 비율"
            side="오른쪽"
            fit={fit}
            thumbOpen={thumbOpen}
            onFit={chooseFit}
            onToggleThumbs={() => useSplit.getState().patch({ thumbOpen: !useSplit.getState().thumbOpen })}
            onPage={goToPage}
            onZoom={(next) => useSplit.getState().patch({ zoom: next, fit: 'custom' })}
          />
        )}
        <div className="viewer-scroll" ref={scrollRef}>
          {(loading || (doc && !fitted)) && (
            <div className="empty">
              <Spinner /> 자료를 여는 중…
            </div>
          )}
          {!doc && !loading && <EmptyState stage>이 영역으로 PDF를 끌어 오세요</EmptyState>}
          {doc &&
            fitted &&
            Array.from({ length: pageCount }, (_, index) => (
              <PlainPdfPage
                key={`${doc.fingerprints?.[0] || 'side'}-${index + 1}`}
                doc={doc}
                pageNumber={index + 1}
                scale={zoom}
                activePage={page}
                pageId={`side-pdf-page-${index + 1}`}
                onVisible={onVisible}
                file={file}
              />
            ))}
        </div>
      </div>
    </section>
  );
}
