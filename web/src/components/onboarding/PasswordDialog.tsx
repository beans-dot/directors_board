import { useState } from 'react';
import { changeOwnPassword, messageOf } from '../../services/runtime';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function PasswordDialog() {
  const open = useApp((state) => state.showPassword);
  const required = useApp((state) => state.passwordRequired);
  const admin = useApp((state) => state.profile?.role) === 'admin';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const mismatch = again.length > 0 && newPassword !== again;
  const canSave = !pending && (required || currentPassword.length > 0) && newPassword.length > 0 && newPassword === again;
  if (!open) return null;
  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (newPassword !== again) {
            setError('새 비밀번호가 서로 다릅니다.');
            return;
          }
          setPending(true);
          setError('');
          void changeOwnPassword(required ? '' : currentPassword, newPassword)
            .then(() => {
              setCurrentPassword('');
              setNewPassword('');
              setAgain('');
              useApp.getState().toast('비밀번호를 저장했습니다.');
            })
            .catch((cause: unknown) => setError(messageOf(cause)))
            .finally(() => setPending(false));
        }}
      >
        <h1>{required ? '비밀번호를 새로 설정해 주세요' : '비밀번호 변경'}</h1>
        <p className="help">
          {required
            ? admin
              ? '처음 로그인 비밀번호는 admin입니다. 새 비밀번호를 두 번 입력합니다.'
              : '처음 로그인 비밀번호는 사번입니다. 새 비밀번호를 두 번 입력합니다.'
            : '새 비밀번호를 두 번 입력합니다. 저장한 뒤부터는 그 비밀번호만 사용합니다.'}
        </p>
        {!required && (
          <label className="field">
            현재 비밀번호
            <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
        )}
        <label className="field">
          새 비밀번호
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="field">
          새 비밀번호 확인
          <input
            type="password"
            autoComplete="new-password"
            aria-invalid={mismatch}
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />
        </label>
        {mismatch && <p className="help">새 비밀번호가 서로 다릅니다.</p>}
        {error && <p className="help">{error}</p>}
        <div className="meeting-actions">
          <Button variant="primary" type="submit" disabled={!canSave}>
            {pending ? '저장 중' : '비밀번호 저장'}
          </Button>
          {!required && (
            <Button variant="line" type="button" onClick={() => useApp.getState().patch({ showPassword: false })}>
              닫기
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
