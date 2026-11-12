export type PageFit = 'width' | 'height';
export type StoredFit = PageFit | 'custom' | 'single';

/** Scale of the single fit, as a fraction of fit-width. Opening a file uses fit-width. */
export const SINGLE_VIEW_WIDTH_RATIO = 0.7;

const FIT_SLACK_PX = 1;
const FIT_ZOOM_MIN = 0.1;
const FIT_ZOOM_MAX = 4;
const PAGE_BORDER_PX = 2;
const PAGE_MARGIN_Y_PX = 16;

export interface PageFitInput {
  mode: PageFit;
  pageWidth: number;
  pageHeight: number;
  /** Scrollport space for the page content, after padding and the page border. */
  viewWidth: number;
  viewHeight: number;
  /** Vertical scrollbar already excluded from viewWidth. */
  reservedX: number;
  /** Horizontal scrollbar already excluded from viewHeight. */
  reservedY: number;
  scrollbar: number;
  pageCount: number;
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function scrollbarThickness(): number {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:100px;height:100px;overflow:scroll;';
  document.body.appendChild(probe);
  const size = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return size > 0 ? size : 0;
}

/** Space the page content can occupy inside the scrollport. */
export function fitTargetBox(scroller: HTMLElement): Omit<PageFitInput, 'mode' | 'pageWidth' | 'pageHeight' | 'pageCount'> {
  const style = getComputedStyle(scroller);
  const padX = px(style.paddingLeft) + px(style.paddingRight);
  const padY = px(style.paddingTop) + px(style.paddingBottom);
  const page = scroller.querySelector('.pdf-page');
  const pageStyle = page instanceof HTMLElement ? getComputedStyle(page) : null;
  const borderX = pageStyle ? px(pageStyle.borderLeftWidth) + px(pageStyle.borderRightWidth) : PAGE_BORDER_PX;
  const borderY = pageStyle ? px(pageStyle.borderTopWidth) + px(pageStyle.borderBottomWidth) : PAGE_BORDER_PX;
  const marginY = pageStyle ? px(pageStyle.marginTop) + px(pageStyle.marginBottom) : PAGE_MARGIN_Y_PX;
  return {
    viewWidth: scroller.clientWidth - padX - borderX,
    viewHeight: scroller.clientHeight - padY - borderY - marginY,
    reservedX: Math.max(0, scroller.offsetWidth - scroller.clientWidth),
    reservedY: Math.max(0, scroller.offsetHeight - scroller.clientHeight),
    scrollbar: scrollbarThickness(),
  };
}

export function layoutFitMode(fit: StoredFit): PageFit | null {
  if (fit === 'height') return 'height';
  if (fit === 'width' || fit === 'single') return 'width';
  return null;
}

/** The single fit is 70% of fit-width. Width and height fit stay exact. */
export function zoomForStoredFit(fit: StoredFit, fitted: number | null): number | null {
  if (fitted === null) return null;
  if (fit !== 'single') return fitted;
  const raw = fitted * SINGLE_VIEW_WIDTH_RATIO;
  if (!Number.isFinite(raw) || raw <= 0) return FIT_ZOOM_MIN;
  const stepped = Math.floor(raw * 1000) / 1000;
  return Math.min(FIT_ZOOM_MAX, Math.max(FIT_ZOOM_MIN, stepped));
}

/**
 * Scale that fits one page to the scrollport.
 * A scrollbar that is not on screen yet is reserved once, so the following layout pass keeps the same scale.
 */
export function pageFitZoom(input: PageFitInput): number | null {
  const { pageWidth, pageHeight } = input;
  if (pageWidth <= 0 || pageHeight <= 0 || input.viewWidth < 8 || input.viewHeight < 8) return null;
  let viewWidth = input.viewWidth;
  let viewHeight = input.viewHeight;
  if (input.mode === 'width') {
    const predictedHeight = pageHeight * (viewWidth / pageWidth);
    const needsVerticalScroll = input.pageCount > 1 || predictedHeight > viewHeight + 1;
    if (needsVerticalScroll && input.reservedX < 1) viewWidth = Math.max(1, viewWidth - input.scrollbar);
  } else {
    const predictedWidth = pageWidth * (viewHeight / pageHeight);
    const needsHorizontalScroll = predictedWidth > viewWidth + 1;
    if (needsHorizontalScroll && input.reservedY < 1) viewHeight = Math.max(1, viewHeight - input.scrollbar);
  }
  const span = input.mode === 'width' ? viewWidth : viewHeight;
  const pageSpan = input.mode === 'width' ? pageWidth : pageHeight;
  const raw = (span - FIT_SLACK_PX) / pageSpan;
  if (!Number.isFinite(raw) || raw <= 0) return FIT_ZOOM_MIN;
  const stepped = Math.floor(raw * 1000) / 1000;
  return Math.min(FIT_ZOOM_MAX, Math.max(FIT_ZOOM_MIN, stepped));
}
