import { useApp } from '../../state/app';
import { FolderTree } from '../tree/FolderTree';
import { RefreshButton } from '../tree/RefreshButton';

export function LeftPanel() {
  const open = useApp((state) => state.drawerOpen);
  return (
    <aside className={`left-panel ${open ? 'open' : ''}`}>
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
            <strong>회의종료 및 자료전송</strong>
            <small>메모를 담아 메일로 보냅니다</small>
          </span>
        </button>
      </div>
      <div className="panel-title">
        <h2>자료 폴더</h2>
        <RefreshButton />
      </div>
      <FolderTree />
    </aside>
  );
}
