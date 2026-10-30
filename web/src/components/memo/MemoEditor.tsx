import { useEffect, useState } from 'react';
import type { Annotation } from '../../api/types';
import { saveMemo } from '../../services/runtime';
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
  const [text, setText] = useState(ann.content);
  useEffect(() => setText(ann.content), [ann.id, ann.content]);
  useEffect(() => {
    if (text === ann.content) return;
    const timer = window.setTimeout(() => {
      void saveMemo({ ...ann, content: text, version: ann.version + 1, updatedAt: new Date().toISOString() }, 'update');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [text, ann]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useMemoStore.getState().patch({ editorId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div
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
        <strong>메모 {number}</strong>
        <button type="button" title="닫기" aria-label="메모 닫기" onClick={() => useMemoStore.getState().patch({ editorId: null })}>
          ×
        </button>
      </div>
      <textarea value={text} aria-label="메모" autoFocus onChange={(event) => setText(event.target.value)} />
      <p className="help">입력하면 자동으로 저장됩니다.</p>
    </div>
  );
}
