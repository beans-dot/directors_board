import { useMemo, useRef, useState } from 'react';
import type { Annotation } from '../../api/types';
import { markHex } from '../../domain/colors';
import { visualRatioToStored } from '../../domain/coords';
import { topFolderOf } from '../../domain/paths';
import { pinNumberMap } from '../../domain/pinNumbers';
import { placeUnderline, type GlyphRun, type UnderlineSpan } from '../../domain/underline';
import { saveMemo } from '../../services/runtime';
import { useMemoStore } from '../../state/memo';
import { useViewer, type MemoTool } from '../../state/viewer';
import { rectFromDrag, type RatioPoint } from './HighlightTool';
import { smoothPath } from './InkTool';
import { MemoEditor } from './MemoEditor';
import { MemoPin } from './MemoPin';

export function MemoLayer({
  page,
  rotate,
  width,
  height,
  lines,
}: {
  page: number;
  rotate: number;
  width: number;
  height: number;
  lines: GlyphRun[];
}) {
  const allItems = useMemoStore((state) => state.items);
  const file = useViewer((state) => state.file);
  const items = useMemo(
    () => allItems.filter((ann) => ann.driveFileId === file?.id && ann.page === page && ann.status === 'active'),
    [allItems, page, file?.id],
  );
  const pinNumbers = useMemo(() => pinNumberMap(items), [items]);
  const tool = useViewer((state) => state.tool);
  const color = useViewer((state) => state.color);
  const readOnly = useViewer((state) => state.readOnly);
  const editorId = useMemoStore((state) => state.editorId);
  const editor = items.find((ann) => ann.id === editorId && ann.type === 'pin');
  const [draft, setDraft] = useState<RatioPoint[] | null>(null);
  const draftRef = useRef<RatioPoint[] | null>(null);
  const start = useRef<RatioPoint | null>(null);
  const dragRef = useRef<PinDrag | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  const placed = (ann: Annotation) => (dragPos?.id === ann.id ? { ...ann, x: dragPos.x, y: dragPos.y } : ann);

  const ratio = (event: React.PointerEvent): RatioPoint => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const visual = visualRatioToStored(rotate, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    return { x: clamp(visual.x), y: clamp(visual.y) };
  };

  const paint = (points: RatioPoint[] | null) => {
    draftRef.current = points;
    setDraft(points);
  };

  const create = (partial: Partial<Annotation>, openEditor: boolean) => {
    if (!file || readOnly) return;
    const now = new Date().toISOString();
    const ann: Annotation = {
      id: crypto.randomUUID(),
      driveFileId: file.id,
      path: file.path,
      folderDate: file.path.split('/')[0] || '',
      topFolder: topFolderOf(file.path),
      page,
      x: 0,
      y: 0,
      w: 0.02,
      h: 0.02,
      type: 'pin',
      content: '',
      color,
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    const store = useMemoStore.getState();
    store.patch({
      items: [...store.items.filter((item) => item.id !== ann.id), ann],
      ...(openEditor ? { editorId: ann.id, activeId: ann.id } : { activeId: ann.id }),
    });
    if (openEditor) useViewer.getState().patch({ tool: 'select' });
    void saveMemo(ann, 'create');
  };

  const eraseAt = (point: RatioPoint) => {
    const hit = hitAnnotation(items, point, width, height, lines);
    if (!hit) return;
    void saveMemo({ ...hit, status: 'deleted', version: hit.version + 1, updatedAt: new Date().toISOString() }, 'delete');
    if (useMemoStore.getState().editorId === hit.id) useMemoStore.getState().patch({ editorId: null, activeId: null });
  };

  const layerBox = (event: React.PointerEvent) => (event.currentTarget as Element).closest('.memo-layer')?.getBoundingClientRect() ?? null;

  const beginDrag = (event: React.PointerEvent, ann: Annotation, openOnTap: boolean) => {
    const current = useViewer.getState().tool;
    if (readOnly || current === 'erase') return;
    event.stopPropagation();
    event.preventDefault();
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      /* 포인터를 잡지 못해도 이동은 이어간다 */
    }
    dragRef.current = {
      id: ann.id,
      originX: ann.x,
      originY: ann.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      openOnTap,
    };
  };

  const dragPoint = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const rect = layerBox(event);
    if (!drag || !rect || rect.width === 0 || rect.height === 0) return null;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    return {
      x: clamp(drag.originX + (event.clientX - drag.startX) / rect.width),
      y: clamp(drag.originY + (event.clientY - drag.startY) / rect.height),
    };
  };

  const moveDrag = (event: React.PointerEvent, ann: Annotation) => {
    if (dragRef.current?.id !== ann.id) return;
    const point = dragPoint(event);
    if (!point) return;
    setDragPos({ id: ann.id, ...point });
  };

  const endDrag = (event: React.PointerEvent, ann: Annotation) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== ann.id) return;
    const point = dragPoint(event);
    const moved = drag.moved;
    const openOnTap = drag.openOnTap;
    dragRef.current = null;
    setDragPos(null);
    if (!point || !moved) {
      const current = useViewer.getState().tool;
      if (openOnTap && (current === 'select' || current === 'pin')) {
        useMemoStore.getState().patch({ editorId: ann.id, activeId: ann.id });
        useViewer.getState().patch({ tool: 'select' });
      }
      return;
    }
    const store = useMemoStore.getState();
    const current = store.items.find((item) => item.id === ann.id) ?? ann;
    const next: Annotation = {
      ...current,
      x: point.x,
      y: point.y,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    store.patch({
      items: store.items.map((item) => (item.id === next.id ? next : item)),
      activeId: next.id,
    });
    void saveMemo(next, 'update');
  };

  const editorView = editor ? placed(editor) : null;

  return (
    <div
      className={`memo-layer tool-${tool}`}
      onPointerDown={(event) => {
        const current = useViewer.getState().tool;
        if (current === 'select' || current === 'erase' || readOnly) return;
        if (event.pointerType === 'touch' && current === 'ink') return;
        const point = ratio(event);
        start.current = point;
        paint([point]);
        const layer = event.currentTarget as HTMLElement;
        if (layer.setPointerCapture) {
          try {
            layer.setPointerCapture(event.pointerId);
          } catch {
            /* 포인터를 잡지 못해도 그리기는 이어간다 */
          }
        }
      }}
      onPointerMove={(event) => {
        const current = useViewer.getState().tool;
        if (!start.current || !draftRef.current || current === 'select' || current === 'erase') return;
        const point = ratio(event);
        paint(current === 'ink' ? [...draftRef.current, point] : [start.current, point]);
      }}
      onPointerUp={(event) => {
        const current = useViewer.getState().tool;
        const point = ratio(event);
        if (current === 'erase') {
          eraseAt(point);
          start.current = null;
          paint(null);
          return;
        }
        if (!start.current) return;
        const stroke = draftRef.current;
        if (current === 'pin') create({ type: 'pin', x: point.x, y: point.y }, true);
        if (current === 'highlight' && stroke && stroke.length > 1) {
          const rect = rectFromDrag(stroke[0], point);
          if (rect.w > 0.004 || rect.h > 0.004) {
            create({ type: 'highlight', ...rect, h: Math.max(rect.h, 0.012), color }, false);
          }
        }
        if (current === 'underline' && stroke && stroke.length > 1) {
          const rect = rectFromDrag(stroke[0], point);
          if (rect.w > 0.004 || rect.h > 0.004) {
            for (const span of placeUnderline(rect, lines)) {
              create({ type: 'underline', x: span.x, y: span.y, w: span.w, h: 0.0015, color }, false);
            }
          }
        }
        if (current === 'ink' && stroke && stroke.length > 1) {
          create({ type: 'ink', x: point.x, y: point.y, color, inkPaths: [smoothPath(stroke)] }, false);
        }
        start.current = null;
        paint(null);
      }}
    >
      <svg width={width} height={height} style={{ width: '100%', height: '100%' }}>
        {items.map((ann) => {
          if (ann.type === 'pin') {
            const view = placed(ann);
            return (
              <g
                key={ann.id}
                className={`memo-pin${dragPos?.id === ann.id ? ' dragging' : ''}`}
                onPointerDown={(event) => beginDrag(event, view, true)}
                onPointerMove={(event) => moveDrag(event, ann)}
                onPointerUp={(event) => endDrag(event, ann)}
                onPointerCancel={(event) => endDrag(event, ann)}
              >
                <MemoPin x={view.x * width} y={view.y * height} n={pinNumbers.get(ann.id) || 1} active={ann.id === editorId} />
              </g>
            );
          }
          if (ann.type === 'highlight') {
            return (
              <rect
                key={ann.id}
                x={ann.x * width}
                y={ann.y * height}
                width={Math.max(ann.w * width, 4)}
                height={Math.max(ann.h * height, 10)}
                fill={markHex(ann.color)}
                opacity={0.35}
                pointerEvents="none"
              />
            );
          }
          if (ann.type === 'underline') {
            return <UnderlineMarks key={ann.id} spans={spansFor(ann, lines)} width={width} height={height} color={ann.color} />;
          }
          return (
            <polyline
              key={ann.id}
              fill="none"
              stroke={markHex(ann.color)}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
              points={(ann.inkPaths?.[0] || []).map(([x, y]) => `${x * width},${y * height}`).join(' ')}
            />
          );
        })}
        {draft && draft.length > 1 && <DraftMark tool={tool} draft={draft} color={color} width={width} height={height} lines={lines} />}
      </svg>
      {editorView && editorView.page === page && (
        <MemoEditor
          ann={editorView}
          number={pinNumbers.get(editorView.id) || 1}
          dragging={dragPos?.id === editorView.id}
          onMoveStart={(event) => beginDrag(event, editorView, false)}
          onMove={(event) => moveDrag(event, editorView)}
          onMoveEnd={(event) => endDrag(event, editorView)}
        />
      )}
    </div>
  );
}

function spansFor(ann: { x: number; y: number; w: number; h: number }, lines: GlyphRun[]): UnderlineSpan[] {
  return placeUnderline({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, lines);
}

function UnderlineMarks({
  spans,
  width,
  height,
  color,
}: {
  spans: UnderlineSpan[];
  width: number;
  height: number;
  color?: string;
}) {
  const stroke = markHex(color);
  return spans.map((span, index) => (
    <line
      key={index}
      x1={span.x * width}
      y1={span.y * height}
      x2={(span.x + span.w) * width}
      y2={span.y * height}
      stroke={stroke}
      strokeWidth={1.75}
      strokeLinecap="butt"
      pointerEvents="none"
    />
  ));
}

function DraftMark({
  tool,
  draft,
  color,
  width,
  height,
  lines,
}: {
  tool: MemoTool;
  draft: RatioPoint[];
  color: string;
  width: number;
  height: number;
  lines: GlyphRun[];
}) {
  if (tool === 'ink') {
    return (
      <polyline
        fill="none"
        stroke={markHex(color)}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
        points={draft.map((point) => `${point.x * width},${point.y * height}`).join(' ')}
      />
    );
  }
  const rect = rectFromDrag(draft[0], draft[draft.length - 1]);
  if (tool === 'highlight') {
    return (
      <rect
        x={rect.x * width}
        y={rect.y * height}
        width={Math.max(rect.w * width, 4)}
        height={Math.max(rect.h * height, 10)}
        fill={markHex(color)}
        opacity={0.35}
        pointerEvents="none"
      />
    );
  }
  if (tool === 'underline') {
    return <UnderlineMarks spans={placeUnderline(rect, lines)} width={width} height={height} color={color} />;
  }
  return null;
}

function hitAnnotation(items: Annotation[], point: RatioPoint, width: number, height: number, lines: GlyphRun[]): Annotation | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const ann = items[index];
    if (ann.type === 'pin') {
      const dx = (ann.x - point.x) * width;
      const dy = (ann.y - point.y) * height;
      if (dx * dx + dy * dy < 22 * 22) return ann;
    } else if (ann.type === 'highlight') {
      if (point.x >= ann.x - 0.004 && point.x <= ann.x + ann.w + 0.004 && point.y >= ann.y && point.y <= ann.y + Math.max(ann.h, 0.012)) return ann;
    } else if (ann.type === 'underline') {
      const spans = spansFor(ann, lines);
      const nearStored = point.x >= ann.x - 0.004 && point.x <= ann.x + ann.w + 0.004 && point.y >= ann.y - 0.01 && point.y <= ann.y + ann.h + 0.01;
      const nearLine = spans.some((span) => point.x >= span.x - 0.004 && point.x <= span.x + span.w + 0.004 && Math.abs(point.y - span.y) * height < 10);
      if (nearStored || nearLine) return ann;
    } else {
      const pts = ann.inkPaths?.[0] || [];
      for (const [x, y] of pts) {
        const dx = (x - point.x) * width;
        const dy = (y - point.y) * height;
        if (dx * dx + dy * dy < 12 * 12) return ann;
      }
    }
  }
  return null;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

interface PinDrag {
  id: string;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
  moved: boolean;
  openOnTap: boolean;
}
