import { useEffect, useState } from 'react';
import type { Officer } from '../../api/types';
import { officerCanLogin } from '../../domain/officers';
import { loadPublicConfig, submitProfile } from '../../services/runtime';
import { useApp } from '../../state/app';

function officerHint(officer: Officer): string {
  if (officerCanLogin(officer)) return officer.name;
  if (!officer.name.trim()) return '이름 설정 전';
  return '메일 설정 전';
}

export function FirstVisitDialog() {
  const open = useApp((state) => state.showOnboarding);
  const profile = useApp((state) => state.profile);
  const config = useApp((state) => state.config);
  const online = useApp((state) => state.online);
  const statusText = useApp((state) => state.statusText);
  const [logoFailed, setLogoFailed] = useState(false);
  const [pendingId, setPendingId] = useState('');

  useEffect(() => {
    if (!open || config) return;
    void loadPublicConfig();
  }, [open, config]);

  if (!open) return null;
  const officers = Array.isArray(config?.officers) ? config.officers : null;
  const canClose = Boolean(profile?.name);
  return (
    <div className="login-screen">
      <div className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div className="login-brand">
          {logoFailed ? (
            <strong>연성대학교</strong>
          ) : (
            <img src="/assets/logo.png" alt="연성대학교" onError={() => setLogoFailed(true)} />
          )}
          <h1 id="login-title">보직을 선택해 주세요</h1>
        </div>
        <p className="help">이 브라우저에 로그인됩니다. 메모는 이 기기에만 남습니다.</p>
        {!online && <p className="help">인터넷에 연결된 뒤 다시 열어 주세요.</p>}
        {online && !config && <p className="help">{statusText || '보직 목록을 불러오는 중'}</p>}
        {online && config && officers === null && (
          <p className="help">보직 목록은 서버 배포를 갱신한 뒤에 나타납니다.</p>
        )}
        {officers && officers.length === 0 && <p className="help">등록된 보직이 없습니다. 관리자에게 문의해 주세요.</p>}
        {officers && officers.length > 0 && (
          <div className="login-list">
            {officers.map((officer) => {
              const ready = officerCanLogin(officer);
              return (
                <button
                  key={officer.id}
                  className="login-choice"
                  type="button"
                  disabled={!ready || pendingId !== ''}
                  onClick={() => {
                    setPendingId(officer.id);
                    void submitProfile(officer).finally(() => setPendingId(''));
                  }}
                >
                  <strong>{officer.position}</strong>
                  <span>{officerHint(officer)}</span>
                </button>
              );
            })}
          </div>
        )}
        {officers?.some((officer) => !officerCanLogin(officer)) && (
          <p className="help">이름과 메일이 없는 직위는 관리자가 채운 뒤에 선택할 수 있습니다.</p>
        )}
        <p className="login-foot">
          {canClose && (
            <button className="tiny-link" type="button" onClick={() => useApp.getState().patch({ showOnboarding: false })}>
              닫기
            </button>
          )}
          <button className="tiny-link" type="button" onClick={() => useApp.getState().patch({ showAdminConvert: true })}>
            admin으로 변환
          </button>
        </p>
      </div>
    </div>
  );
}
