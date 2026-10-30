import { refreshTree } from '../../services/runtime';
import { useApp } from '../../state/app';
import { useTree } from '../../state/tree';
import { Spinner } from '../common/Spinner';

export function RefreshButton() {
  const loading = useTree((state) => state.loading);
  const last = useApp((state) => state.lastFetchedAt);
  return (
    <button
      className="btn btn-line btn-sm"
      type="button"
      aria-label="새로고침"
      title={last ? `${last.slice(11, 16)} 확인` : '새로고침'}
      disabled={loading}
      onClick={() => {
        void refreshTree('refresh');
      }}
    >
      {loading ? <Spinner /> : '↻'}
    </button>
  );
}
