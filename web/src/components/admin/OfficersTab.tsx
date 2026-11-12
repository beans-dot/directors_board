import { useEffect, useRef, useState } from 'react';
import { clearLoginLock, listLoginLocks, saveOfficers, resetOfficerPassword } from '../../api/materials';
import type { LoginLock, Officer } from '../../api/types';
import { moveOfficer, prepareOfficerList } from '../../domain/officers';
import { messageOf, syncStoredOfficer } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

function lockLabel(lock: LoginLock): string {
  if (lock.kind === 'address') return `접속 주소 ${lock.name}`;
  return [lock.position, lock.name].filter(Boolean).join(' ');
}

function lockRemain(lockedUntil: number): string {
  const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
  return `${minutes}분 남음`;
}

export function OfficersTab() {
  const settings = useAdmin((state) => state.settings);
  const [rows, setRows] = useState<Officer[]>([]);
  const [locks, setLocks] = useState<LoginLock[] | null>(null);
  const [pendingKey, setPendingKey] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [error, setError] = useState('');
  const dragId = useRef('');
  const hydrated = useRef(false);
  const supported = settings != null && Array.isArray(settings.officers);

  useEffect(() => {
    let alive = true;
    void listLoginLocks()
      .then((next) => {
        if (alive) setLocks(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(messageOf(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated.current || !supported || !settings?.officers) return;
    hydrated.current = true;
    setRows(settings.officers.map((row) => ({ ...row })));
  }, [supported, settings]);

  const update = (id: string, patch: Partial<Officer>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const save = () => {
    const prepared = prepareOfficerList(rows);
    if ('error' in prepared) {
      setError(prepared.error);
      return;
    }
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin') return;
    setError('');
    void saveOfficers(prepared.officers)
      .then(async (officers) => {
        const currentSettings = useAdmin.getState().settings;
        const config = useApp.getState().config;
        const synced = await syncStoredOfficer(useApp.getState().profile, officers);
        useAdmin.getState().patch({
          settings: currentSettings ? { ...currentSettings, officers } : currentSettings,
        });
        useApp.getState().patch({
          profile: synced ?? useApp.getState().profile,
          config: config ? { ...config, officers } : config,
        });
        setRows(officers.map((row) => ({ ...row })));
        useApp.getState().toast('보직자를 저장했습니다.');
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  };

  if (!settings) return <p className="help">설정을 불러오는 중</p>;
  if (!supported) {
    return <p className="help">보직자 설정은 Apps Script 배포를 새 버전으로 갱신한 뒤에 사용할 수 있습니다.</p>;
  }

  const unlock = (lock: LoginLock) => {
    setPendingKey(lock.key);
    setError('');
    void clearLoginLock(lock.key)
      .then((next) => {
        setLocks(next);
        useApp.getState().toast(`${lockLabel(lock)} 잠금을 풀었습니다.`);
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setPendingKey(''));
  };

  return (
    <div>
      <section className="login-locks">
        <h3>로그인 잠금</h3>
        <p className="help">
          다섯 번 연속으로 틀리면 그 계정과 접속 주소가 15분 동안 멈춥니다. 여기서 풀어 주면 바로 다시 로그인할 수 있습니다.
        </p>
        {locks === null && <p className="help">잠금을 확인하는 중</p>}
        {locks && locks.length === 0 && <p className="help">잠긴 로그인이 없습니다.</p>}
        {locks?.map((lock) => (
          <div className="lock-row" key={lock.key}>
            <strong>{lockLabel(lock)}</strong>
            <span>{lockRemain(lock.lockedUntil)}</span>
            <button
              className="btn btn-line"
              type="button"
              aria-label={`${lockLabel(lock)} 잠금 해제`}
              disabled={pendingKey === lock.key}
              onClick={() => unlock(lock)}
            >
              잠금 해제
            </button>
          </div>
        ))}
      </section>
      <p className="help">직위, 이름, 사번을 등록합니다. 줄을 끌어 놓으면 로그인 화면의 순서가 됩니다. 저장해야 반영됩니다. 처음 로그인 비밀번호는 사번이고, 비밀번호 초기화도 사번으로 되돌립니다.</p>
      {rows.map((row) => (
        <div
          className={draggingId === row.id ? 'officer-row dragging' : 'officer-row'}
          key={row.id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const fromId = dragId.current;
            dragId.current = '';
            setDraggingId('');
            if (fromId) setRows((current) => moveOfficer(current, fromId, row.id));
          }}
        >
          <button
            className="officer-grip"
            type="button"
            draggable
            aria-label={`${[row.position, row.name].filter(Boolean).join(' ') || '보직자'} 순서 바꾸기`}
            onDragStart={(event) => {
              dragId.current = row.id;
              setDraggingId(row.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', row.id);
            }}
            onDragEnd={() => {
              dragId.current = '';
              setDraggingId('');
            }}
          >
            ⋮⋮
          </button>
          <label className="field">
            직위
            <input value={row.position} onChange={(event) => update(row.id, { position: event.target.value })} />
          </label>
          <label className="field">
            이름
            <input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} />
          </label>
          <label className="field">
            사번
            <input
              value={row.employeeNo || ''}
              autoComplete="off"
              onChange={(event) => update(row.id, { employeeNo: event.target.value })}
            />
          </label>
          <label className="field">
            이메일
            <input
              value={row.email}
              placeholder="선택"
              onChange={(event) => update(row.id, { email: event.target.value })}
            />
          </label>
          <button
            className="btn btn-line"
            type="button"
            onClick={() => {
              void resetOfficerPassword(row.id)
                .then(() => useApp.getState().toast(`${row.name || row.position} 비밀번호를 사번으로 초기화했습니다.`))
                .catch((cause: unknown) => setError(messageOf(cause)));
            }}
          >
            비밀번호 초기화
          </button>
          <button className="btn btn-line" type="button" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>
            삭제
          </button>
        </div>
      ))}
      {rows.length === 0 && <p className="help">등록된 보직자가 없습니다.</p>}
      {error && <p className="help" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="line"
          type="button"
          onClick={() =>
            setRows((current) => [...current, { id: crypto.randomUUID(), position: '', name: '', email: '', employeeNo: '' }])
          }
        >
          보직자 추가
        </Button>
        <Button variant="primary" type="button" onClick={save}>
          저장
        </Button>
      </div>
    </div>
  );
}
