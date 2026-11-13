import { useEffect, useRef, useState } from 'react';
import type { Annotation } from '../../api/types';
import { commitOpenMemo, removeMemo, setOpenMemoDraft } from '../../services/runtime';
import { useMemoStore } from '../../state/memo';

export function MemoEditor({
  ann,
  number,
  dragging,
  onMoveStart,
  onMove,
  onMoveEnd,
}: {
  ann: Annotation;
  number: number;
  dragging?: boolean;
  onMoveStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMoveEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(ann.content);
  const close = () => {
    void commitOpenMemo();
    useMemoStore.getState().patch({ editorId: null });
  };
  const remove = () => {
    setOpenMemoDraft(null);
    const current = useMemoStore.getState().items.find((item) => item.id === ann.id) ?? ann;
    void removeMemo(current);
  };
  setOpenMemoDraft({ id: ann.id, text, ann });
  useEffect(() => setText(ann.content), [ann.id, ann.content]);
  useEffect(() => {
    if (text === ann.content) return;
    const timer = window.setTimeout(() => {
      void commitOpenMemo();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [text, ann]);
  useEffect(() => {
    const dismiss = () => {
      void commitOpenMemo();
      useMemoStore.getState().patch({ editorId: null });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      dismiss();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
  useEffect(() => () => {
    void commitOpenMemo();
  }, []);
  return (
    <div
      ref={rootRef}
      className="memo-editor"
      style={{ left: `${Math.min(ann.x * 100, 62)}%`, top: `${Math.min(Math.max(ann.y * 100, 0), 58)}%` }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div
        className={`memo-editor-head${dragging ? ' dragging' : ''}`}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          onMoveStart(event);
        }}
        onPointerMove={onMove}
        onPointerUp={onMoveEnd}
        onPointerCancel={onMoveEnd}
      >
        <span className="memo-editor-title">
          <span className="memo-editor-num">{number}</span>
          메모
        </span>
        <span className="memo-editor-actions">
          <button type="button" className="memo-editor-delete" title="삭제" aria-label="메모 삭제" onClick={remove}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M5 7h14M9 7V4.5h6V7M7.5 7l.8 12.5h7.4L16.5 7M10 10.5v6M14 10.5v6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="memo-editor-close" title="닫기" aria-label="메모 닫기" onClick={close}>
            ×
          </button>
        </span>
      </div>
      <textarea
        value={text}
        aria-label="메모"
        placeholder="메모를 입력하세요"
        autoFocus
        onChange={(event) => setText(event.target.value)}
      />
      <p className="help">입력하면 자동으로 저장됩니다.</p>
    </div>
  );
}
