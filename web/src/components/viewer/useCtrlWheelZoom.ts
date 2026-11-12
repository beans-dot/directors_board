import { useEffect, useRef, type RefObject } from 'react';
import { wheelDeltaPixels } from './wheelZoom';

/** Ctrl+wheel and trackpad pinch zoom this element instead of the browser page. */
export function useCtrlWheelZoom(
  ref: RefObject<HTMLElement | null>,
  onZoom: (deltaY: number) => void,
  resetKey: unknown = 0,
) {
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onZoomRef.current(wheelDeltaPixels(event.deltaY, event.deltaMode));
    };
    node.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => node.removeEventListener('wheel', onWheel, { capture: true });
  }, [ref, resetKey]);
}
