import { useApp } from '../../state/app';
import { FolderTree } from '../tree/FolderTree';
import { RefreshButton } from '../tree/RefreshButton';

function PanelChevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d={open ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LeftPanel() {
  const drawerOpen = useApp((state) => state.drawerOpen);
  const open = useApp((state) => state.folderOpen);
  const tip = open ? '자료 접기' : '자료 보기';
  return (
    <aside className={`left-panel${drawerOpen ? ' open' : ''}${open ? ' expanded' : ''}`}>
      <div className="left-panel-clip" id="folder-panel">
        <div className="left-panel-body">
          <div className="left-head">
            <button
              className="send-launch"
              type="button"
              onClick={() => {
                if (!navigator.onLine) {
                  useApp.getState().toast('인터넷 연결 후 다시 시도');
                  return;
                }
                useApp.getState().patch({ showSend: true });
              }}
              data-open-send="1"
              id="open-send"
            >
              <img src="/assets/send-meeting.svg" alt="" />
              <span className="send-launch-copy">
                <strong>전체 회의자료 내려받기</strong>
                <small>메모와 필기를 포함한 회의자료를 이 기기에 저장합니다</small>
              </span>
            </button>
          </div>
          <div className="panel-title">
            <h2>자료 폴더</h2>
            <RefreshButton />
          </div>
          <FolderTree />
        </div>
      </div>
      <div className="folder-bookmark-anchor">
        <button
          className={`folder-bookmark${open ? ' on' : ''}`}
          type="button"
          aria-label={tip}
          aria-expanded={open}
          aria-controls="folder-panel"
          onClick={() => useApp.getState().patch({ folderOpen: !open })}
        >
          <PanelChevron open={open} />
        </button>
        <span className="folder-bookmark-tip" aria-hidden="true">
          {tip}
        </span>
      </div>
    </aside>
  );
}
