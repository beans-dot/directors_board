import { useEffect } from 'react';
import { findTextHits, type FindHit } from '../../domain/pdfFind';
import { useViewer } from '../../state/viewer';
import { scrollFindHit, scrollToPdfPage, takePageFromObserver } from './pageScroll';
import { EmptyState } from '../common/EmptyState';
import { Spinner } from '../common/Spinner';
import { FindBar } from './FindBar';
import { PdfPage } from './PdfPage';
import { ThumbnailRail } from './ThumbnailRail';
import {
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
import { ZoomControls } from './ZoomControls';
import { MARK_COLORS } from '../../domain/colors';

export function PdfViewer() {
  const doc = useViewer((state) => state.doc);
  const pageCount = useViewer((state) => state.pageCount);
  const zoom = useViewer((state) => state.zoom);
  const loading = useViewer((state) => state.loading);
  const tool = useViewer((state) => state.tool);
  const color = useViewer((state) => state.color);
  const thumbOpen = useViewer((state) => state.thumbOpen);
  const findOpen = useViewer((state) => state.findOpen);
  const page = useViewer((state) => state.page);
  const local = useViewer((state) => state.local);
  const findQuery = useViewer((state) => state.findQuery);
  const findTick = useViewer((state) => state.findTick);
  const query = findQuery.trim();

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
          <ZoomControls />
          <span className="tool-split" />
          <div className="tool-group">
            <ToolButton label="폭맞춤" onClick={() => useViewer.getState().patch({ fit: 'width', zoom: 1 })}>
              <IconFitWidth />
            </ToolButton>
            <ToolButton label="쪽맞춤" onClick={() => useViewer.getState().patch({ fit: 'page', zoom: 1 })}>
              <IconFitPage />
            </ToolButton>
            <ToolButton label="썸네일" on={thumbOpen} onClick={() => useViewer.getState().patch({ thumbOpen: !thumbOpen })}>
              <IconThumbs />
            </ToolButton>
          </div>
          <span className="tool-split" />
          <div className="tool-group">
            <ToolButton label="찾기" on={findOpen} onClick={() => useViewer.getState().patch({ findOpen: !findOpen })}>
              <IconFind />
            </ToolButton>
            <FindBar />
          </div>
          {local && local.versions.length > 0 && (
            <>
              <span className="tool-split" />
              <select
                aria-label="버전"
                onChange={(event) => {
                  const version = local.versions.find((item) => item.blobKey === event.target.value);
                  if (!version) return;
                  useViewer.getState().patch({ readOnly: true });
                }}
              >
                <option value="">현재 버전</option>
                {local.versions.map((version) => (
                  <option key={version.blobKey} value={version.blobKey}>
                    이전 {version.replacedAt.slice(0, 16)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="toolbar-row">
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
          <span className="tool-split" />
          <ToolButton label="지우개" on={tool === 'erase'} onClick={() => useViewer.getState().patch({ tool: 'erase' })}>
            <IconEraser />
          </ToolButton>
        </div>
      </div>
      <div className="viewer-wrap">
        <ThumbnailRail />
        <div className="viewer-scroll">
          {loading && (
            <div className="empty">
              <Spinner /> 자료를 여는 중…
            </div>
          )}
          {!doc && !loading && <EmptyState>왼쪽에서 자료를 선택하세요</EmptyState>}
          {doc &&
            Array.from({ length: pageCount }, (_, index) => (
              <PdfPage key={`${doc.fingerprints?.[0] || 'pdf'}-${index + 1}`} doc={doc} pageNumber={index + 1} scale={zoom} />
            ))}
        </div>
      </div>
    </div>
  );
}
