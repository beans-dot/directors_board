import { lazy, Suspense, useEffect } from 'react';
import { AdminPage } from './components/admin/AdminPage';
import { Toast } from './components/common/Toast';
import { Header } from './components/layout/Header';
import { LeftPanel } from './components/layout/LeftPanel';
import { MainArea } from './components/layout/MainArea';
import { BackupPanel } from './components/memo/BackupPanel';
import { AdminConvertDialog } from './components/onboarding/AdminConvertDialog';
import { FirstVisitDialog } from './components/onboarding/FirstVisitDialog';
import { PasswordDialog } from './components/onboarding/PasswordDialog';
import { showFileChangeAlert } from './domain/changeNotice';
import { boot, overwriteConflictMemo, reloadConflictMemo } from './services/runtime';
import { useApp } from './state/app';

const SendDialog = lazy(() => import('./components/send/SendDialog').then((mod) => ({ default: mod.SendDialog })));

export default function App() {
  const screen = useApp((state) => state.screen);
  const statusText = useApp((state) => state.statusText);
  const online = useApp((state) => state.online);
  const replaceNotice = useApp((state) => state.replaceNotice);
  const showReplaceNotice = useApp((state) => showFileChangeAlert(state.profile?.role) && !!state.replaceNotice);
  const showSend = useApp((state) => state.showSend);
  const memoSyncText = useApp((state) => state.memoSyncText);

  useEffect(() => {
    void boot();
    const timer = window.setTimeout(() => {
      void import('./components/send/SendDialog');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="app">
      <Header />
      {(!online || statusText) && <div className="banner">{statusText || '서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.'}</div>}
      {memoSyncText && (
        <div className="banner">
          {memoSyncText}
          {memoSyncText.includes('겹쳐') && (
            <>
              <button className="tiny-link" type="button" onClick={() => void overwriteConflictMemo()}>
                이 내용으로 저장
              </button>
              <button className="tiny-link" type="button" onClick={() => void reloadConflictMemo()}>
                서버 메모 불러오기
              </button>
            </>
          )}
        </div>
      )}
      {screen === 'admin' ? (
        <AdminPage />
      ) : (
        <div className="workspace">
          <LeftPanel />
          <MainArea />
        </div>
      )}
      <FirstVisitDialog />
      <PasswordDialog />
      <AdminConvertDialog />
      <BackupPanel />
      {showSend && (
        <Suspense fallback={null}>
          <SendDialog />
        </Suspense>
      )}
      {showReplaceNotice && replaceNotice && (
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
