import { useEffect, useRef, useState } from 'react';
import { accountLabel } from '../../domain/account';
import { logoutAdmin, messageOf, requestConnectedRefresh } from '../../services/runtime';
import { useApp } from '../../state/app';
import { scrollToPdfPage } from '../viewer/pageScroll';
import { useViewer } from '../../state/viewer';
import { UsageTipBar } from './UsageTipBar';

function goFirstPage() {
  useApp.getState().patch({ screen: 'main' });
  const viewer = useViewer.getState();
  if (viewer.doc && viewer.page !== 1) viewer.patch({ page: 1 });
  const scroll = () => scrollToPdfPage(1);
  scroll();
  window.setTimeout(scroll, 0);
}

function reloadApp() {
  window.location.reload();
}

function UserMenu() {
  const profile = useApp((state) => state.profile);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile?.name) return null;
  return (
    <div className="account-menu" ref={rootRef}>
      <button
        className="user-chip user-chip-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {accountLabel(profile)}
      </button>
      {open && (
        <div className="account-menu-panel" role="menu">
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              useApp.getState().patch({ showPassword: true, passwordRequired: false });
            }}
          >
            비밀번호 변경
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void logoutAdmin();
            }}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const profile = useApp((state) => state.profile);
  const [logoFailed, setLogoFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = () => {
    setRefreshing(true);
    void requestConnectedRefresh()
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setRefreshing(false));
  };
  return (
    <header className="header">
      <div className="brand">
        <button className="brand-home" type="button" aria-label="첫 페이지로 이동" onClick={goFirstPage}>
          {logoFailed ? <strong>연성대학교</strong> : <img src="/assets/logo.png" alt="" onError={() => setLogoFailed(true)} />}
        </button>
        <span className="brand-divider" />
        <h1>
          <button
            className="brand-home"
            type="button"
            onClick={() => {
              if (profile?.role === 'admin') {
                useApp.getState().patch({ screen: 'main' });
                return;
              }
              reloadApp();
            }}
          >
            보직회의 지원 시스템
          </button>
        </h1>
      </div>
      <div className="usage-tip-slot">
        <UsageTipBar />
      </div>
      <div className="header-meta">
        <UserMenu />
        {profile?.role === 'admin' && (
          <button className="btn btn-line btn-sm" type="button" onClick={() => useApp.getState().patch({ screen: 'admin' })}>
            관리
          </button>
        )}
        {profile?.role === 'admin' && (
          <button
            className="btn btn-line btn-sm"
            type="button"
            disabled={refreshing}
            title="열어 둔 화면이 자료 폴더를 확인하고, 아직 받지 않은 PDF를 받습니다."
            onClick={refreshAll}
          >
            전체새로고침
          </button>
        )}
      </div>
    </header>
  );
}
