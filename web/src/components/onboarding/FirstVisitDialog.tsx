import { useEffect, useState } from 'react';
import type { Officer } from '../../api/types';
import { officerCanLogin } from '../../domain/officers';
import { loadPublicConfig, loginAdmin, loginAsOfficer, messageOf } from '../../services/runtime';
import { useApp } from '../../state/app';

export function FirstVisitDialog() {
  const open = useApp((state) => state.showOnboarding);
  const profile = useApp((state) => state.profile);
  const config = useApp((state) => state.config);
  const online = useApp((state) => state.online);
  const statusText = useApp((state) => state.statusText);
  const [logoFailed, setLogoFailed] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || config) return;
    void loadPublicConfig();
  }, [open, config]);

  if (!open) return null;
  const officers = Array.isArray(config?.officers) ? config.officers : null;
  const enter = (officer?: Officer) => {
    if (pendingId) return;
    setPendingId(officer?.id || 'admin');
    setError('');
    void (officer ? loginAsOfficer(officer) : loginAdmin())
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setPendingId(''));
  };

  return (
    <div className="login-screen">
      <div className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title" aria-busy={Boolean(pendingId)}>
        <div className="login-brand">
          {logoFailed ? (
            <strong>연성대학교</strong>
          ) : (
            <img src="/assets/logo.png" alt="연성대학교" onError={() => setLogoFailed(true)} />
          )}
          <h1 id="login-title">보직을 선택해 주세요</h1>
        </div>
        <p className="help">본인의 직위와 이름을 클릭하면 바로 로그인됩니다.</p>
        {!online && <p className="help">인터넷에 연결된 뒤 다시 열어 주세요.</p>}
        {online && !config && <p className="help">{statusText || '보직 목록을 불러오는 중'}</p>}
        {online && config && officers === null && <p className="help">보직 목록은 서버 배포를 갱신한 뒤에 나타납니다.</p>}
        {officers && officers.length === 0 && <p className="help">등록된 보직이 없습니다. 관리자에게 문의해 주세요.</p>}
        {officers && officers.length > 0 && (
          <div className="login-list">
            {officers.map((officer) => (
              <button
                key={officer.id}
                className="login-choice"
                type="button"
                disabled={!online || !officerCanLogin(officer) || pendingId !== ''}
                onClick={() => enter(officer)}
              >
                <strong>{officer.position}</strong>
                <span>{pendingId === officer.id ? '로그인 중…' : officer.name || '이름 설정 전'}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="help" role="alert">{error}</p>}
        <p className="login-foot">
          {profile?.name && (
            <button className="tiny-link" type="button" disabled={Boolean(pendingId)} onClick={() => useApp.getState().patch({ showOnboarding: false })}>
              닫기
            </button>
          )}
          <button className="tiny-link" type="button" disabled={!online || Boolean(pendingId)} onClick={() => enter()}>
            {pendingId === 'admin' ? '로그인 중…' : 'admin으로 들어가기'}
          </button>
        </p>
      </div>
    </div>
  );
}
