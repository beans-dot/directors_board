import { useEffect, useRef, useState } from 'react';
import { gasCall } from '../../api/client';
import type { Officer } from '../../api/types';
import { prepareOfficerList } from '../../domain/officers';
import { messageOf, syncStoredOfficer } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function OfficersTab() {
  const settings = useAdmin((state) => state.settings);
  const [rows, setRows] = useState<Officer[]>([]);
  const [error, setError] = useState('');
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
    if (!profile?.adminToken) return;
    setError('');
    void gasCall<{ officers?: Officer[] }>('setConfig', { officers: prepared.officers }, {
      deviceId: profile.deviceId,
      adminToken: profile.adminToken,
    })
      .then(async (result) => {
        const officers = result.officers || prepared.officers;
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
      <p className="help">직위, 이름, 메일만 등록합니다. 로그인 화면의 선택과 자료전송 받는 주소에 쓰입니다.</p>
      {rows.map((row) => (
        <div className="officer-row" key={row.id}>
          <label className="field">
            직위
            <input value={row.position} onChange={(event) => update(row.id, { position: event.target.value })} />
          </label>
          <label className="field">
            이름
            <input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} />
          </label>
          <label className="field">
            이메일
            <input
              value={row.email}
              placeholder="name@yeonsung.ac.kr"
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
            setRows((current) => [...current, { id: crypto.randomUUID(), position: '', name: '', email: '' }])
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
