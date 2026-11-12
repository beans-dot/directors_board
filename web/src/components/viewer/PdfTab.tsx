import type { PageFit } from './fitZoom';
import { IconFitPage, IconFitWidth, IconThumbs, ToolButton } from './ToolIcons';
import { ZoomControls } from './ZoomControls';

export function PdfTab({
  title,
  onClose,
  closeLabel,
  pageLabel,
  zoomLabel,
  zoom,
  page,
  pageCount,
  onZoom,
  onPage,
  side,
  fit,
  thumbOpen,
  onFit,
  onToggleThumbs,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  pageLabel?: string;
  zoomLabel?: string;
  zoom?: number;
  page?: number;
  pageCount?: number;
  onZoom?: (zoom: number) => void;
  onPage?: (page: number) => void;
  side?: string;
  fit?: string;
  thumbOpen?: boolean;
  onFit?: (mode: PageFit) => void;
  onToggleThumbs?: () => void;
}) {
  const named = (label: string) => (side ? `${side} ${label}` : label);
  return (
    <div className="pdf-tab">
      <div className="pdf-tab-title">
        <strong title={title}>{title}</strong>
        <button className="pdf-tab-close" type="button" aria-label={closeLabel} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="pdf-tab-tools">
        <ZoomControls
          zoom={zoom}
          page={page}
          pageCount={pageCount}
          onZoom={onZoom}
          onPage={onPage}
          pageLabel={pageLabel}
          zoomLabel={zoomLabel}
        />
        {onFit && onToggleThumbs && (
          <>
            <span className="tool-split" />
            <div className="tool-group">
              <ToolButton label={named('폭맞춤')} on={fit === 'width'} onClick={() => onFit('width')}>
                <IconFitWidth />
              </ToolButton>
              <ToolButton label={named('높이맞춤')} on={fit === 'height'} onClick={() => onFit('height')}>
                <IconFitPage />
              </ToolButton>
              <ToolButton label={named('썸네일')} on={thumbOpen} onClick={onToggleThumbs}>
                <IconThumbs />
              </ToolButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
