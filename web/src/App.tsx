import { useEffect } from 'react';
import { AdminPage } from './components/admin/AdminPage';
import { Toast } from './components/common/Toast';
import { Header } from './components/layout/Header';
import { LeftPanel } from './components/layout/LeftPanel';
import { MainArea } from './components/layout/MainArea';
import { BackupPanel } from './components/memo/BackupPanel';
import { AdminConvertDialog } from './components/onboarding/AdminConvertDialog';
import { FirstVisitDialog } from './components/onboarding/FirstVisitDialog';
import { SendDialog } from './components/send/SendDialog';
import { boot } from './services/runtime';
import { useApp } from './state/app';

export default function App() {
  const screen = useApp((state) => state.screen);
  const statusText = useApp((state) => state.statusText);
  const online = useApp((state) => state.online);
  const replaceNotice = useApp((state) => state.replaceNotice);

  useEffect(() => {
    void boot();
  }, []);

  return (
    <div className="app">
      <Header />
      {(!online || statusText) && <div className="banner">{statusText || '오프라인입니다. 받아둔 자료만 볼 수 있어요.'}</div>}
      {screen === 'admin' ? (
        <AdminPage />
      ) : (
        <div className="workspace">
          <LeftPanel />
          <MainArea />
        </div>
      )}
      <FirstVisitDialog />
      <AdminConvertDialog />
      <BackupPanel />
      <SendDialog />
      {replaceNotice && (
        <div className="modal-back" onClick={() => useApp.getState().patch({ replaceNotice: null })}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>자료가 바뀌었음</h2>
            <p>{replaceNotice}</p>
            <button className="btn btn-primary" type="button" onClick={() => useApp.getState().patch({ replaceNotice: null })}>
              확인
            </button>
          </div>
        </div>
      )}
      <Toast />
    </div>
  );
}
