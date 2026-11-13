import { useEffect, useState } from 'react';
import type { Officer } from '../../api/types';
import { officerCanLogin } from '../../domain/officers';
import { loadPublicConfig, loginAdmin, loginWithPassword, messageOf } from '../../services/runtime';
import { useApp } from '../../state/app';
import { Modal } from '../common/Modal';

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
  const [picked, setPicked] = useState<Officer | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [adminPending, setAdminPending] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    if (!open || config) return;
    void loadPublicConfig();
  }, [open, config]);

  if (!open) return null;
  const officers = Array.isArray(config?.officers) ? config.officers : null;
  const canClose = Boolean(profile?.name);
  return (
    <>
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
        <p className="help">직위를 고른 뒤 비밀번호를 입력합니다.</p>
        <p className="login-notice">초기 비밀번호는 사번입니다.</p>
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
                    setPicked(officer);
                    setPassword('');
                    setError('');
                  }}
                >
                  <strong>{officer.position}</strong>
                  <span>{officerHint(officer)}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="login-foot">
          {canClose && (
            <button className="tiny-link" type="button" onClick={() => useApp.getState().patch({ showOnboarding: false })}>
              닫기
            </button>
          )}
          <button
            className="tiny-link"
            type="button"
            disabled={adminPending}
            onClick={() => {
              setAdminOpen(true);
              setAdminPassword('');
              setError('');
            }}
          >
            admin으로 들어가기
          </button>
        </p>
      </div>
    </div>
    {picked && (
      <Modal
        title="비밀번호"
        onClose={() => {
          if (pendingId) return;
          setPicked(null);
          setPassword('');
          setError('');
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPendingId(picked.id);
            setError('');
            void loginWithPassword(picked, password)
              .catch((cause: unknown) => setError(messageOf(cause)))
              .finally(() => setPendingId(''));
          }}
        >
          <p>
            <strong>{picked.position}</strong> {picked.name}
          </p>
          <label className="field">
            비밀번호
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="help">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={pendingId !== '' || password.length === 0}>
            {pendingId ? '확인 중' : '로그인'}
          </button>
        </form>
      </Modal>
    )}
    {adminOpen && (
      <Modal
        title="관리자 비밀번호"
        onClose={() => {
          if (adminPending) return;
          setAdminOpen(false);
          setAdminPassword('');
          setError('');
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAdminPending(true);
            setError('');
            void loginAdmin(adminPassword)
              .then(() => {
                setAdminOpen(false);
                setAdminPassword('');
              })
              .catch((cause: unknown) => setError(messageOf(cause)))
              .finally(() => setAdminPending(false));
          }}
        >
          <label className="field">
            비밀번호
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
            />
          </label>
          {error && <p className="help">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={adminPending || adminPassword.length === 0}>
            {adminPending ? '확인 중' : '로그인'}
          </button>
        </form>
      </Modal>
    )}
    </>
  );
}
