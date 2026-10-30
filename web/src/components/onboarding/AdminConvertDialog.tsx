import { useState } from 'react';
import { loginAdmin, messageOf } from '../../services/runtime';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

export function AdminConvertDialog() {
  const open = useApp((state) => state.showAdminConvert);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!open) return null;
  return (
    <Modal title="admin으로 변환" onClose={() => useApp.getState().patch({ showAdminConvert: false })}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void loginAdmin(password)
            .then(() => setPassword(''))
            .catch((err: unknown) => {
              setError(messageOf(err));
            });
        }}
      >
        <label className="field">
          비밀번호
          <input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p>{error}</p>}
        <Button variant="primary" type="submit">
          확인
        </Button>
      </form>
    </Modal>
  );
}
