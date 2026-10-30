import { useEffect } from 'react';
import { gasCall } from '../../api/client';
import type { AccessRow, AdminSettings, DeviceRow, SendLogRow } from '../../api/types';
import { logoutAdmin, messageOf } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';
import { AccessLogTab } from './AccessLogTab';
import { OfficersTab } from './OfficersTab';
import { MeetingTab } from './MeetingTab';
import { OperationsTab } from './OperationsTab';
import { SendLogTab } from './SendLogTab';

export function AdminPage() {
  const tab = useAdmin((state) => state.tab);
  useEffect(() => {
    const profile = useApp.getState().profile;
    if (!profile?.adminToken) return;
    const call = { deviceId: profile.deviceId, adminToken: profile.adminToken };
    useAdmin.getState().patch({ loading: true });
    void Promise.all([
      gasCall<{ rows: DeviceRow[] }>('logs', { type: 'devices' }, call),
      gasCall<{ rows: AccessRow[] }>('logs', { type: 'access' }, call),
      gasCall<{ rows: SendLogRow[] }>('logs', { type: 'send' }, call),
      gasCall<{ settings: AdminSettings }>('logs', { type: 'settings' }, call),
    ])
      .then(([devices, access, sends, settings]) => {
        useAdmin.getState().patch({
          devices: devices.rows,
          access: access.rows,
          sends: sends.rows,
          settings: settings.settings,
          loading: false,
        });
      })
      .catch((error: unknown) => {
        useAdmin.getState().patch({ loading: false });
        useApp.getState().toast(messageOf(error));
        if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'UNAUTHORIZED') {
          void logoutAdmin();
        }
      });
  }, []);
  return (
    <div className="admin-page">
      <Button variant="line" type="button" onClick={() => useApp.getState().patch({ screen: 'main' })}>
        뒤로가기
      </Button>
      <div className="tabs">
        {(
          [
            ['meeting', '회의 일시'],
            ['access', '접속 현황'],
            ['send', '발송 기록'],
            ['officers', '보직자'],
            ['ops', '운영 설정'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} type="button" onClick={() => useAdmin.getState().patch({ tab: id })}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'meeting' && <MeetingTab />}
      {tab === 'access' && <AccessLogTab />}
      {tab === 'send' && <SendLogTab />}
      {tab === 'officers' && <OfficersTab />}
      {tab === 'ops' && <OperationsTab />}
      <p className="help">
        회의 일시를 정하면 그 날짜 폴더와 본문/별첨/규정 폴더가 Drive에 만들어집니다. PDF는 그 폴더에 올리면 됩니다. 일시를
        지우면 예약만 없어지고 자료 폴더는 남습니다. 자동생성을 켜 두면 매주 월요일 오후 1시에 다음 주 월요일 10시 회의와
        폴더가 만들어지고, 그 월요일이 휴일이면 넘어갑니다. 웹앱을 열면 자료 동기화를 한 번 합니다. 보직을 고르기 전에도
        같습니다. 그 다음부터는 회의 10분 전부터 시작 1분 전까지 1분마다 자료 목록을 확인하고, 없거나 바뀐 PDF만 받아 둡니다.
        PDF가 아닌 파일은 목록에 나오지 않습니다.
      </p>
      <Button variant="danger" type="button" onClick={() => void logoutAdmin()}>
        관리자 해제
      </Button>
    </div>
  );
}
