import { useViewer } from '../../state/viewer';
import { nextFindIndex } from '../../domain/pdfFind';

export function FindBar() {
  const open = useViewer((state) => state.findOpen);
  const query = useViewer((state) => state.findQuery);
  const hits = useViewer((state) => state.findHits);
  const index = useViewer((state) => state.findIndex);
  if (!open) return null;
  const jump = (delta: number) => {
    const state = useViewer.getState();
    if (state.findHitQuery !== state.findQuery.trim()) return;
    const next = nextFindIndex(state.findIndex, state.findHits.length, delta);
    const hit = state.findHits[next];
    if (!hit) return;
    state.patch({ findIndex: next, page: hit.page, findTick: state.findTick + 1 });
  };
  return (
    <form
      className="find-inline"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <input
        aria-label="문서 검색"
        value={query}
        placeholder="문서에서 찾기"
        autoFocus
        onChange={(event) => useViewer.getState().patch({ findQuery: event.target.value })}
        onKeyDown={(event) => {
          if ((event.key !== 'Enter' && event.key !== 'NumpadEnter') || event.nativeEvent.isComposing) return;
          event.preventDefault();
          jump(event.shiftKey ? -1 : 1);
        }}
      />
      <span>
        {hits.length && index >= 0 ? index + 1 : 0}/{hits.length}
      </span>
      <button type="button" title="이전 찾기" aria-label="이전 찾기" onClick={() => jump(-1)}>
        ‹
      </button>
      <button type="button" title="다음 찾기" aria-label="다음 찾기" onClick={() => jump(1)}>
        ›
      </button>
    </form>
  );
}
