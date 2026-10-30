import { useViewer } from '../../state/viewer';
import { IconNext, IconPrev, IconZoomIn, IconZoomOut, ToolButton } from './ToolIcons';

export function ZoomControls() {
  const zoom = useViewer((state) => state.zoom);
  const page = useViewer((state) => state.page);
  const pageCount = useViewer((state) => state.pageCount);
  const setZoom = (next: number) => useViewer.getState().patch({ zoom: Math.min(4, Math.max(0.25, next)), fit: 'custom' });
  return (
    <div className="tool-group">
      <ToolButton label="이전 페이지" onClick={() => useViewer.getState().patch({ page: Math.max(1, page - 1) })}>
        <IconPrev />
      </ToolButton>
      <label className="page-field">
        <input
          aria-label="페이지"
          value={pageCount ? page : ''}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next >= 1 && next <= pageCount) useViewer.getState().patch({ page: next });
          }}
        />
        <span>/ {pageCount || 0}</span>
      </label>
      <ToolButton label="다음 페이지" onClick={() => useViewer.getState().patch({ page: Math.min(pageCount, page + 1) })}>
        <IconNext />
      </ToolButton>
      <ToolButton label="축소" onClick={() => setZoom(zoom - 0.25)}>
        <IconZoomOut />
      </ToolButton>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <ToolButton label="확대" onClick={() => setZoom(zoom + 0.25)}>
        <IconZoomIn />
      </ToolButton>
    </div>
  );
}
