let fromObserver = false;
const visiblePx = new Map<number, number>();

export function markPageFromObserver(): void {
  fromObserver = true;
}

export function notePageVisibility(pageNumber: number, visibleHeight: number): number | null {
  if (visibleHeight <= 0) visiblePx.delete(pageNumber);
  else visiblePx.set(pageNumber, visibleHeight);
  let bestPage = 0;
  let bestHeight = 0;
  for (const [page, height] of visiblePx) {
    if (height > bestHeight) {
      bestPage = page;
      bestHeight = height;
    }
  }
  if (bestHeight < 80) return null;
  return bestPage;
}

export function clearPageVisibility(pageNumber: number): void {
  visiblePx.delete(pageNumber);
}

export function resetPageVisibility(): void {
  visiblePx.clear();
}

export function scrollToPdfPage(page: number): void {
  const node = document.getElementById(`pdf-page-${page}`);
  const scroller = node?.closest('.viewer-scroll');
  if (!node || !scroller) return;
  const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top });
}

export function scrollFindHit(node: HTMLElement): boolean {
  const scroller = node.closest('.viewer-scroll');
  if (!(scroller instanceof HTMLElement)) return false;
  const mark = node.getBoundingClientRect();
  if (mark.height < 1) return false;
  const view = scroller.getBoundingClientRect();
  const top = mark.top - view.top + scroller.scrollTop - view.height / 2 + mark.height / 2;
  scroller.scrollTo({ top: Math.max(0, top) });
  return true;
}

export function takePageFromObserver(): boolean {
  const marked = fromObserver;
  fromObserver = false;
  return marked;
}
