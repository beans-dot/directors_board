import { useEffect, useRef, useState } from 'react';
import { saveOfficers } from '../../api/materials';
import type { Officer } from '../../api/types';
import { moveOfficer, prepareOfficerList } from '../../domain/officers';
import { messageOf, syncStoredOfficer } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function OfficersTab() {
  const settings = useAdmin((state) => state.settings);
  const [rows, setRows] = useState<Officer[]>([]);
  const [draggingId, setDraggingId] = useState('');
  const [error, setError] = useState('');
  const dragId = useRef('');
  const hydrated = useRef(false);
  const supported = settings != null && Array.isArray(settings.officers);

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

  return (
    <div>
      <p className="help">직위와 이름을 등록하면 로그인 화면에서 바로 선택할 수 있습니다. 사번과 이메일은 선택 사항입니다. 줄을 끌어 놓으면 로그인 화면의 순서가 됩니다. 저장해야 반영됩니다.</p>
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
              placeholder="선택"
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
