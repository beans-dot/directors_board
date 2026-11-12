import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  USAGE_TIP_INTERVAL_MS,
  USAGE_TIP_LINE_PX,
  USAGE_TIP_SLIDE_MS,
  usageTipCharLimit,
} from '../../domain/usageTip';
import { useApp } from '../../state/app';

function reducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

type Slide = { from: number; to: number; delta: 1 | -1; phase: 'prep' | 'armed' | 'run' };

export function UsageTipBar() {
  const stored = useApp((state) => state.config?.usageTips);
  const tips = useMemo(() => (stored ?? []).map((tip) => tip.trim()).filter(Boolean), [stored]);
  const tipKey = tips.join('\n');
  const [visible, setVisible] = useState(0);
  const [slide, setSlide] = useState<Slide | null>(null);
  const [epoch, setEpoch] = useState(0);
  const windowRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const visibleRef = useRef(0);
  const tipsRef = useRef(tips);
  const lockRef = useRef(false);
  const beginRef = useRef<(delta: 1 | -1) => boolean>(() => false);
  visibleRef.current = visible;
  tipsRef.current = tips;

  const begin = (delta: 1 | -1) => {
    const list = tipsRef.current;
    if (list.length < 2 || lockRef.current) return false;
    const from = visibleRef.current;
    const to = (from + delta + list.length) % list.length;
    visibleRef.current = to;
    setVisible(to);
    if (reducedMotion()) {
      setSlide(null);
      return true;
    }
    lockRef.current = true;
    setSlide({ from, to, delta, phase: 'prep' });
    return true;
  };
  beginRef.current = begin;

  useEffect(() => {
    lockRef.current = false;
    setSlide(null);
    setVisible(0);
    visibleRef.current = 0;
  }, [tipKey]);

  useEffect(() => {
    if (tips.length < 2) return;
    const timer = window.setInterval(() => beginRef.current(1), USAGE_TIP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [tipKey, tips.length, epoch]);

  useEffect(() => {
    if (!slide || slide.phase === 'run') return;
    const timer = window.setTimeout(() => {
      setSlide((current) => {
        if (!current || current.phase === 'run') return current;
        return { ...current, phase: current.phase === 'prep' ? 'armed' : 'run' };
      });
    }, 20);
    return () => window.clearTimeout(timer);
  }, [slide]);

  useEffect(() => {
    if (slide?.phase !== 'run') return;
    const timer = window.setTimeout(() => {
      lockRef.current = false;
      setSlide(null);
    }, USAGE_TIP_SLIDE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [slide]);

  useLayoutEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      const width = windowRef.current?.clientWidth ?? 0;
      const charWidth = probeRef.current?.getBoundingClientRect().width ?? 0;
      const limit = usageTipCharLimit(width, charWidth);
      if (limit == null) return;
      const state = useApp.getState();
      if (state.usageTipLimit === limit && state.usageTipWidth === width) return;
      state.patch({ usageTipLimit: limit, usageTipWidth: width });
    };
    publish();
    const node = windowRef.current;
    const observer = typeof ResizeObserver === 'undefined' || !node ? null : new ResizeObserver(publish);
    observer?.observe(node as HTMLDivElement);
    const fonts = document.fonts;
    if (fonts?.ready) void fonts.ready.then(publish);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  const nudge = (delta: 1 | -1) => {
    if (beginRef.current(delta)) setEpoch((current) => current + 1);
  };

  const rows = !slide
    ? tips[visible]
      ? [tips[visible]]
      : []
    : slide.delta > 0
      ? [tips[slide.from], tips[slide.to]]
      : [tips[slide.to], tips[slide.from]];
  const shift = !slide ? 0 : slide.delta > 0 ? (slide.phase === 'run' ? 1 : 0) : slide.phase === 'run' ? 0 : 1;
  const current = tips[visible] ?? '';
  const canMove = tips.length > 1 && !slide;

  return (
    <div className="usage-tip">
      <span className="usage-tip-label">사용 Tip</span>
      <div className="usage-tip-window" ref={windowRef}>
        <span ref={probeRef} className="usage-tip-probe" aria-hidden="true">
          가
        </span>
        {rows.length > 0 && (
          <div
            className="usage-tip-track"
            aria-hidden="true"
            style={{
              transform: `translateY(-${shift * USAGE_TIP_LINE_PX}px)`,
              transition: slide && slide.phase !== 'prep' ? `transform ${USAGE_TIP_SLIDE_MS}ms ease` : 'none',
            }}
            onTransitionEnd={(event) => {
              if (event.propertyName !== 'transform' || slide?.phase !== 'run') return;
              lockRef.current = false;
              setSlide(null);
            }}
          >
            {rows.map((tip, item) => (
              <div className="usage-tip-line" key={`${item}-${tip}`} style={{ height: USAGE_TIP_LINE_PX, lineHeight: `${USAGE_TIP_LINE_PX}px` }}>
                {tip}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="usage-tip-nav">
        <button type="button" aria-label="이전 사용 Tip" disabled={!canMove} onClick={() => nudge(-1)}>
          ▲
        </button>
        <button type="button" aria-label="다음 사용 Tip" disabled={!canMove} onClick={() => nudge(1)}>
          ▼
        </button>
      </div>
      <span className="usage-tip-live" aria-live="polite">
        {current}
      </span>
    </div>
  );
}
