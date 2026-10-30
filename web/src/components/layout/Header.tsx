import { useState } from 'react';
import { accountLabel } from '../../domain/account';
import { formatKoreanDate } from '../../domain/folderDate';
import { logoutAdmin } from '../../services/runtime';
import { useApp } from '../../state/app';
import { scrollToPdfPage } from '../viewer/pageScroll';
import { useViewer } from '../../state/viewer';

function goFirstPage() {
  useApp.getState().patch({ screen: 'main' });
  const viewer = useViewer.getState();
  if (viewer.doc && viewer.page !== 1) viewer.patch({ page: 1 });
  const scroll = () => scrollToPdfPage(1);
  scroll();
  window.setTimeout(scroll, 0);
}

export function Header() {
  const profile = useApp((state) => state.profile);
  const menuOpen = useApp((state) => state.menuOpen);
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <header className="header">
      <div className="brand">
        <button className="brand-home" type="button" aria-label="첫 페이지로 이동" onClick={goFirstPage}>
          {logoFailed ? <strong>연성대학교</strong> : <img src="/assets/logo.png" alt="" onError={() => setLogoFailed(true)} />}
        </button>
        <span className="brand-divider" />
        <h1>
          <button className="brand-home" type="button" onClick={goFirstPage}>
            보직회의 지원 시스템
          </button>
        </h1>
      </div>
      <div className="header-date">{formatKoreanDate()}</div>
      <div className="header-meta">
        {profile?.role === 'admin' && (
          <button className="btn btn-line btn-sm" type="button" onClick={() => useApp.getState().patch({ screen: 'admin', menuOpen: false })}>
            관리
          </button>
        )}
        {profile?.name && (
          <div className="user-menu">
            <button className="user-chip" type="button" onClick={() => useApp.getState().patch({ menuOpen: !menuOpen })}>
              {accountLabel(profile)}
            </button>
            {menuOpen && (
              <div className="menu">
                {profile.role !== 'admin' && (
                  <button type="button" onClick={() => useApp.getState().patch({ showOnboarding: true, menuOpen: false })}>
                    보직 다시 선택
                  </button>
                )}
                {profile.role !== 'admin' && (
                  <button type="button" onClick={() => useApp.getState().patch({ showAdminConvert: true, menuOpen: false })}>
                    admin으로 변환
                  </button>
                )}
                {profile.role === 'admin' && (
                  <button type="button" onClick={() => useApp.getState().patch({ screen: 'admin', menuOpen: false })}>
                    관리 화면
                  </button>
                )}
                {profile.role === 'admin' && (
                  <button type="button" onClick={() => void logoutAdmin()}>
                    관리자 해제
                  </button>
                )}
                <button type="button" onClick={() => useApp.getState().patch({ showBackup: true, menuOpen: false })}>
                  메모 백업
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ok = navigator.storage?.persisted?.();
                    void Promise.resolve(ok).then((value) =>
                      useApp.getState().toast(value ? '브라우저 저장소가 유지됩니다.' : '브라우저 데이터를 지우지 마세요'),
                    );
                  }}
                >
                  저장공간 정보
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
