import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { showPdfVersionHistory } from '../../domain/changeNotice';
import { marksToClear } from '../../domain/marks';
import { findTextHits, type FindHit } from '../../domain/pdfFind';
import { pdfVersionLabel } from '../../domain/pdfVersion';
import { downloadServerFile } from '../../api/materials';
import { clearFileMarks, closeOpenPdf, messageOf, openPdf, openStoredVersion } from '../../services/runtime';
import { useApp } from '../../state/app';
import { useMemoStore } from '../../state/memo';
import { useTree } from '../../state/tree';
import { useViewer } from '../../state/viewer';
import { splitRatioFromDrag, useSplit } from '../../state/splitView';
import { fitTargetBox, layoutFitMode, pageFitZoom, zoomForStoredFit, type PageFit } from './fitZoom';
import { scrollFindHit, scrollToPdfPage, takePageFromObserver } from './pageScroll';
import { EmptyState } from '../common/EmptyState';
import { Modal } from '../common/Modal';
import { Spinner } from '../common/Spinner';
import { FindBar } from './FindBar';
import { PdfPage } from './PdfPage';
import { ThumbnailRail } from './ThumbnailRail';
import {
  IconClearMarks,
  IconEraser,
  IconFind,
  IconFitPage,
  IconFitWidth,
  IconHighlight,
  IconNote,
  IconPen,
  IconSelect,
  IconThumbs,
  IconUnderline,
  ToolButton,
} from './ToolIcons';
import { useCtrlWheelZoom } from './useCtrlWheelZoom';
import { zoomFromWheel } from './wheelZoom';
import { ZoomControls } from './ZoomControls';
import { PdfTab } from './PdfTab';
import { SplitPdfPane } from './SplitPdfPane';
import { usePdfDrop } from './usePdfDrop';
import { MARK_COLORS } from '../../domain/colors';
import { Button } from '../common/Button';

export function PdfViewer() {
  const doc = useViewer((state) => state.doc);
  const pageCount = useViewer((state) => state.pageCount);
  const zoom = useViewer((state) => state.zoom);
  const fit = useViewer((state) => state.fit);
  const loading = useViewer((state) => state.loading);
  const tool = useViewer((state) => state.tool);
  const color = useViewer((state) => state.color);
  const thumbOpen = useViewer((state) => state.thumbOpen);
  const findOpen = useViewer((state) => state.findOpen);
  const page = useViewer((state) => state.page);
  const local = useViewer((state) => state.local);
  const file = useViewer((state) => state.file);
  const readOnly = useViewer((state) => state.readOnly);
  const viewingKey = useViewer((state) => state.viewingKey);
  const role = useApp((state) => state.profile?.role);
  const notices = useTree((state) => state.changeNotices);
  const versions = [...(local?.versions ?? [])].sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
  const showVersions = showPdfVersionHistory({ role, notices, file, versionCount: versions.length });
  const findQuery = useViewer((state) => state.findQuery);
  const findTick = useViewer((state) => state.findTick);
  const query = findQuery.trim();
  const scrollRef = useRef<HTMLDivElement>(null);
  const applyFitRef = useRef<(scroll: boolean) => Promise<void>>(async () => {});
  const scrollAfterFit = useRef(false);
  const widthFromSplit = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<{ startX: number; startRatio: number; width: number } | null>(null);
  const [fitDoc, setFitDoc] = useState<PDFDocumentProxy | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [splitDragging, setSplitDragging] = useState(false);
  const splitOpen = useSplit((state) => state.open);
  const splitRatio = useSplit((state) => state.ratio);
  const leftDrop = usePdfDrop((node) => {
    void openPdf(node);
  });
  const fitted = !doc || fit === 'custom' || fitDoc === doc;

  const askClearMarks = () => {
    if (!file || readOnly) return;
    const count = marksToClear(useMemoStore.getState().items, file.id).length;
    if (!count) {
      useApp.getState().toast('지울 필기가 없습니다.');
      return;
    }
    setClearOpen(true);
  };

  const runClearMarks = () => {
    if (!file) return;
    void clearFileMarks(file.id)
      .then((count) => {
        setClearOpen(false);
        useApp.getState().toast(count ? `필기 ${count}개를 지웠습니다.` : '지울 필기가 없습니다.');
      })
      .catch(() => useApp.getState().toast('필기를 지우지 못했습니다.'));
  };

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [doc]);

  useLayoutEffect(() => {
    if (layoutFitMode(fit)) scrollAfterFit.current = true;
  }, [doc, fit]);

  useCtrlWheelZoom(
    scrollRef,
    (deltaY) => {
      const current = useViewer.getState().zoom;
      const next = zoomFromWheel(current, deltaY);
      if (Math.abs(next - current) <= 0.0005) return;
      useViewer.getState().patch({ zoom: next, fit: 'custom' });
    },
    splitOpen,
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let cancel = false;
    let generation = 0;
    const apply = async (scroll: boolean) => {
      const token = ++generation;
      const state = useViewer.getState();
      const mode = layoutFitMode(state.fit);
      if (cancel || !state.doc || !mode) return;
      try {
        const pageNumber = Math.min(Math.max(1, state.page), state.doc.numPages);
        const pdfPage = await state.doc.getPage(pageNumber);
        if (cancel || token !== generation || useViewer.getState().doc !== state.doc) return;
        if (useViewer.getState().fit !== state.fit) return;
        const viewport = pdfPage.getViewport({ scale: 1 });
        const box = fitTargetBox(scroller);
        const next = zoomForStoredFit(
          state.fit,
          pageFitZoom({
            mode,
            pageWidth: viewport.width,
            pageHeight: viewport.height,
            pageCount: state.doc.numPages,
            ...box,
          }),
        );
        if (next === null || cancel || token !== generation || useViewer.getState().fit !== state.fit) return;
        if (Math.abs(next - useViewer.getState().zoom) > 0.0005) useViewer.getState().patch({ zoom: next });
        if (scroll) scrollAfterFit.current = true;
        setFitDoc(state.doc);
      } catch {
        if (!cancel && token === generation && state.doc) setFitDoc(state.doc);
      }
    };
    applyFitRef.current = apply;
    if (!doc || !layoutFitMode(fit)) {
      if (doc) setFitDoc(doc);
      return;
    }
    void apply(true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => void apply(false));
    observer?.observe(scroller);
    return () => {
      cancel = true;
      observer?.disconnect();
    };
  }, [doc, fit, splitOpen]);

  useEffect(() => {
    if (!doc || !layoutFitMode(fit)) return;
    void applyFitRef.current(false);
  }, [page, doc, fit]);

  useEffect(() => {
    if (!scrollAfterFit.current || !layoutFitMode(fit) || !doc || fitDoc !== doc) return;
    const pageNumber = useViewer.getState().page;
    const node = document.getElementById(`pdf-page-${pageNumber}`);
    if (!node) return;
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!scrollAfterFit.current || node.offsetHeight < 40) return;
      scrollToPdfPage(pageNumber);
      scrollAfterFit.current = false;
      observer.disconnect();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [doc, fit, fitDoc, zoom, page]);

  useEffect(() => {
    if (showVersions || !viewingKey) return;
    void openStoredVersion('');
  }, [showVersions, viewingKey]);

  const chooseFit = (mode: PageFit) => {
    widthFromSplit.current = false;
    scrollAfterFit.current = true;
    if (useViewer.getState().fit !== mode) useViewer.getState().patch({ fit: mode });
    else void applyFitRef.current(true);
  };

  const toggleSplit = () => {
    const next = !useSplit.getState().open;
    const current = useViewer.getState().fit;
    if (next && current === 'single') {
      widthFromSplit.current = true;
      useViewer.getState().patch({ fit: 'width' });
    } else if (!next && widthFromSplit.current && current === 'width') {
      widthFromSplit.current = false;
      useViewer.getState().patch({ fit: 'single' });
    }
    useSplit.getState().patch({ open: next });
  };

  const onSplitDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = splitRef.current;
    if (!host) return;
    event.preventDefault();
    splitDrag.current = { startX: event.clientX, startRatio: useSplit.getState().ratio, width: host.clientWidth };
    setSplitDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onSplitMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current;
    if (!drag) return;
    useSplit.getState().patch({ ratio: splitRatioFromDrag(drag.startRatio, event.clientX - drag.startX, drag.width) });
  };

  const onSplitUp = () => {
    splitDrag.current = null;
    setSplitDragging(false);
  };

  const onSplitKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 0.05 : -0.05;
    useSplit.getState().patch({ ratio: splitRatioFromDrag(useSplit.getState().ratio, delta, 1) });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && useViewer.getState().doc) {
        event.preventDefault();
        useViewer.getState().patch({ findOpen: true });
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.find-inline input')?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (takePageFromObserver()) return;
    const state = useViewer.getState();
    const hit = state.findIndex >= 0 ? state.findHits[state.findIndex] : undefined;
    if (state.findTick > 0 && hit?.page === page) {
      const node = document.getElementById(`pdf-page-${page}`)?.querySelector('[data-find="current"]');
      if (node instanceof HTMLElement && scrollFindHit(node)) return;
    }
    scrollToPdfPage(page);
  }, [page, findTick]);

  useEffect(() => {
    if (!doc || !query) {
      useViewer.getState().patch({ findHits: [], findIndex: -1, findHitQuery: '' });
      return;
    }
    let cancel = false;
    useViewer.getState().patch({ findHits: [], findIndex: -1, findHitQuery: '' });
    void (async () => {
      const hits: FindHit[] = [];
      for (let number = 1; number <= doc.numPages; number += 1) {
        if (cancel) return;
        const pdfPage = await doc.getPage(number);
        const text = await pdfPage.getTextContent();
        if (cancel) return;
        const items = text.items.flatMap((item) =>
          'str' in item && item.str
            ? [
                {
                  str: item.str,
                  hasEOL: item.hasEOL,
                  dir: item.dir,
                  transform: item.transform as number[],
                  width: item.width,
                  height: item.height,
                },
              ]
            : [],
        );
        hits.push(...findTextHits(items, pdfPage.getViewport({ scale: 1 }), number, query));
      }
      if (!cancel) useViewer.getState().patch({ findHits: hits, findIndex: -1, findHitQuery: query });
    })();
    return () => {
      cancel = true;
    };
  }, [doc, pageCount, query]);

  return (
    <div className="viewer-column">
      <div className="toolbar">
        <div className="toolbar-row">
          {!splitOpen && <ZoomControls />}
          {!splitOpen && <span className="tool-split" />}
          {!splitOpen && (
            <div className="tool-group">
              <ToolButton label="폭맞춤" on={fit === 'width'} onClick={() => chooseFit('width')}>
                <IconFitWidth />
              </ToolButton>
              <ToolButton label="높이맞춤" on={fit === 'height'} onClick={() => chooseFit('height')}>
                <IconFitPage />
              </ToolButton>
              <ToolButton label="썸네일" on={thumbOpen} onClick={() => useViewer.getState().patch({ thumbOpen: !thumbOpen })}>
                <IconThumbs />
              </ToolButton>
            </div>
          )}
          {!splitOpen && <span className="tool-split" />}
          <div className="tool-group">
            <ToolButton label="선택" on={tool === 'select'} onClick={() => useViewer.getState().patch({ tool: 'select' })}>
              <IconSelect />
            </ToolButton>
            <ToolButton label="메모" on={tool === 'pin'} onClick={() => useViewer.getState().patch({ tool: 'pin' })}>
              <IconNote />
            </ToolButton>
            <ToolButton label="형광펜" on={tool === 'highlight'} onClick={() => useViewer.getState().patch({ tool: 'highlight' })}>
              <IconHighlight />
            </ToolButton>
            <ToolButton label="밑줄" on={tool === 'underline'} onClick={() => useViewer.getState().patch({ tool: 'underline' })}>
              <IconUnderline />
            </ToolButton>
            <ToolButton label="손글씨" on={tool === 'ink'} onClick={() => useViewer.getState().patch({ tool: 'ink' })}>
              <IconPen />
            </ToolButton>
            <ToolButton label="지우개" on={tool === 'erase'} onClick={() => useViewer.getState().patch({ tool: 'erase' })}>
              <IconEraser />
            </ToolButton>
            <ToolButton
              label="필기 모두 지우기"
              hint="메모는 남기고 형광펜, 밑줄, 손글씨를 모두 지웁니다."
              disabled={!file || readOnly}
              onClick={askClearMarks}
            >
              <IconClearMarks />
            </ToolButton>
          </div>
          {(tool === 'highlight' || tool === 'underline' || tool === 'ink') && (
            <>
              <span className="tool-split" />
              <div className="tool-group" role="group" aria-label="색">
                {MARK_COLORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`color-dot${color === item.id ? ' on' : ''}`}
                    title={item.label}
                    aria-label={item.label}
                    style={{ background: item.hex }}
                    onClick={() => useViewer.getState().patch({ color: item.id })}
                  />
                ))}
              </div>
            </>
          )}
          {showVersions && (
            <>
              <span className="tool-split" />
              <select
                className="version-select"
                aria-label="버전"
                value={viewingKey}
                onChange={(event) => {
                  void openStoredVersion(event.target.value);
                }}
              >
                <option value="">현재 버전</option>
                {versions.map((version) => (
                  <option key={version.blobKey} value={version.blobKey}>
                    {pdfVersionLabel(version.replacedAt)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="toolbar-row">
          <div className="tool-group">
            <ToolButton label="찾기" on={findOpen} onClick={() => useViewer.getState().patch({ findOpen: !findOpen })}>
              <IconFind />
            </ToolButton>
            <FindBar />
          </div>
          <span className="tool-split" />
          <button
            type="button"
            className={`split-toggle${splitOpen ? ' on' : ''}`}
            aria-pressed={splitOpen}
            aria-label="PDF 2개 보기"
            onClick={toggleSplit}
          >
            <span>PDF 2개 보기</span>
            <span className="split-switch" aria-hidden="true" />
          </button>
          {file && (
            <button
              className="btn btn-line btn-sm"
              type="button"
              title="메모, 필기 등이 함께 다운로드 됩니다"
              onClick={() => {
                void downloadServerFile(file.id, file.name).catch((error: unknown) => useApp.getState().toast(messageOf(error)));
              }}
            >
              이 자료 내려받기
            </button>
          )}
          {splitOpen && <p className="split-hint">자료 폴더 영역에서 보고싶은 PDF를 아래 영역으로 드래그 하세요</p>}
        </div>
      </div>
      {splitOpen ? (
        <div className={`split-view${splitDragging ? ' dragging' : ''}`} ref={splitRef}>
          <div className={`split-pane${leftDrop.over ? ' over' : ''}`} style={{ flex: `${splitRatio} 1 0` }} {...leftDrop.bind}>
            <ThumbnailRail />
            <div className="pane-column">
              {file && (
                <PdfTab
                  title={file.name.replace(/\.pdf$/i, '')}
                  closeLabel="왼쪽 PDF 닫기"
                  onClose={closeOpenPdf}
                  pageLabel="왼쪽 페이지"
                  zoomLabel="왼쪽 확대 비율"
                  side="왼쪽"
                  fit={fit}
                  thumbOpen={thumbOpen}
                  onFit={chooseFit}
                  onToggleThumbs={() => useViewer.getState().patch({ thumbOpen: !useViewer.getState().thumbOpen })}
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
                    <PdfPage key={`${doc.fingerprints?.[0] || 'pdf'}-${index + 1}`} doc={doc} pageNumber={index + 1} scale={zoom} />
                  ))}
              </div>
            </div>
          </div>
          <div
            className={`split-handle${splitDragging ? ' on' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="영역 너비"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={Math.round(splitRatio * 100)}
            tabIndex={0}
            onPointerDown={onSplitDown}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitUp}
            onPointerCancel={onSplitUp}
            onKeyDown={onSplitKey}
          />
          <SplitPdfPane />
        </div>
      ) : (
        <div className={`viewer-wrap${leftDrop.over ? ' over' : ''}`} {...leftDrop.bind}>
          <ThumbnailRail />
          <div className="viewer-scroll" ref={scrollRef}>
            {(loading || (doc && !fitted)) && (
              <div className="empty">
                <Spinner /> 자료를 여는 중…
              </div>
            )}
            {!doc && !loading && <EmptyState stage>왼쪽에서 자료를 선택하세요</EmptyState>}
            {doc &&
              fitted &&
              Array.from({ length: pageCount }, (_, index) => (
                <PdfPage key={`${doc.fingerprints?.[0] || 'pdf'}-${index + 1}`} doc={doc} pageNumber={index + 1} scale={zoom} />
              ))}
          </div>
        </div>
      )}
      {clearOpen && (
        <Modal title="필기 모두 지우기" onClose={() => setClearOpen(false)}>
          <p>이 자료의 형광펜, 밑줄, 손글씨를 지웁니다. 메모는 남습니다.</p>
          <div className="modal-actions">
            <Button variant="line" type="button" onClick={() => setClearOpen(false)}>
              취소
            </Button>
            <Button variant="danger" type="button" onClick={runClearMarks}>
              지우기
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
