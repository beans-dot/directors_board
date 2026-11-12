import { useEffect, useRef, useState } from 'react';
import { useViewer } from '../../state/viewer';
import { IconNext, IconPrev, IconZoomIn, IconZoomOut, ToolButton } from './ToolIcons';
import { clampZoom } from './wheelZoom';

function percentOf(zoom: number) {
  return Math.round(zoom * 100);
}

export function ZoomControls({
  zoom: zoomProp,
  page: pageProp,
  pageCount: pageCountProp,
  onZoom,
  onPage,
  pageLabel = '페이지',
  zoomLabel = '확대 비율',
}: {
  zoom?: number;
  page?: number;
  pageCount?: number;
  onZoom?: (zoom: number) => void;
  onPage?: (page: number) => void;
  pageLabel?: string;
  zoomLabel?: string;
} = {}) {
  const storeZoom = useViewer((state) => state.zoom);
  const storePage = useViewer((state) => state.page);
  const storePageCount = useViewer((state) => state.pageCount);
  const controlled = onZoom !== undefined;
  const zoom = controlled ? (zoomProp ?? storeZoom) : storeZoom;
  const page = controlled ? (pageProp ?? storePage) : storePage;
  const pageCount = controlled ? (pageCountProp ?? storePageCount) : storePageCount;
  const percent = percentOf(zoom);
  const [draft, setDraft] = useState(String(percent));
  const [editing, setEditing] = useState(false);
  const skipCommit = useRef(false);
  const zoomRef = useRef(zoom);
  const pageRef = useRef(page);
  const pageCountRef = useRef(pageCount);
  zoomRef.current = zoom;
  pageRef.current = page;
  pageCountRef.current = pageCount;

  useEffect(() => {
    if (!editing) setDraft(String(percent));
  }, [percent, editing]);

  const zoomNow = () => (controlled ? zoomRef.current : useViewer.getState().zoom);

  const setZoom = (next: number) => {
    const zoomValue = clampZoom(next);
    if (onZoom) onZoom(zoomValue);
    else useViewer.getState().patch({ zoom: zoomValue, fit: 'custom' });
  };

  const setPage = (next: number) => {
    if (onPage) onPage(next);
    else useViewer.getState().patch({ page: next });
  };

  const commit = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    const next = Number(digits);
    const current = percentOf(zoomNow());
    if (!digits || !Number.isFinite(next)) {
      setDraft(String(current));
      return;
    }
    if (next === current) return;
    setZoom(next / 100);
  };

  return (
    <div className="tool-group">
      <ToolButton label="이전 페이지" onClick={() => setPage(Math.max(1, pageRef.current - 1))}>
        <IconPrev />
      </ToolButton>
      <label className="page-field">
        <input
          aria-label={pageLabel}
          value={pageCount ? page : ''}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next >= 1 && next <= pageCountRef.current) setPage(next);
          }}
        />
        <span>/ {pageCount || 0}</span>
      </label>
      <ToolButton label="다음 페이지" onClick={() => setPage(Math.min(pageCountRef.current, pageRef.current + 1))}>
        <IconNext />
      </ToolButton>
      <ToolButton label="축소" onClick={() => setZoom(zoomNow() - 0.25)}>
        <IconZoomOut />
      </ToolButton>
      <label className="zoom-field">
        <input
          aria-label={zoomLabel}
          inputMode="numeric"
          value={editing ? draft : String(percent)}
          onFocus={(event) => {
            skipCommit.current = false;
            setEditing(true);
            setDraft(String(percentOf(zoomNow())));
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
          onBlur={() => {
            setEditing(false);
            if (skipCommit.current) {
              skipCommit.current = false;
              setDraft(String(percentOf(zoomNow())));
              return;
            }
            commit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              skipCommit.current = true;
              setDraft(String(percentOf(zoomNow())));
              event.currentTarget.blur();
            }
          }}
        />
        <span>%</span>
      </label>
      <ToolButton label="확대" onClick={() => setZoom(zoomNow() + 0.25)}>
        <IconZoomIn />
      </ToolButton>
    </div>
  );
}
