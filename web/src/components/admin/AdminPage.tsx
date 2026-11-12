import { useEffect } from 'react';
import { loadAdminHome } from '../../api/materials';
import { logoutAdmin, messageOf } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';
import { AccessLogTab } from './AccessLogTab';
import { OfficersTab } from './OfficersTab';
import { MaterialsTab } from './MaterialsTab';
import { MeetingTab } from './MeetingTab';
import { UsageTipTab } from './UsageTipTab';

const ADMIN_MENU = [
  ['materials', '회의자료관리', '날짜 폴더를 고르고 본문, 별첨, 규정에 PDF를 올립니다.'],
  ['meeting', '회의 일시', '회의 날짜와 시간을 정합니다.'],
  ['access', '접속 현황', '접속한 기기와 최근 기록을 봅니다.'],
  ['officers', '보직자', '로그인에 쓰는 직위와 이름을 등록합니다.'],
  ['tips', '사용 Tip', '화면 위 안내 문장을 바꿉니다.'],
] as const;

export function AdminPage() {
  const tab = useAdmin((state) => state.tab);
  useEffect(() => {
    useAdmin.getState().patch({ tab: 'materials' });
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin') return;
    useAdmin.getState().patch({ loading: true });
    void loadAdminHome()
      .then((home) => {
        useAdmin.getState().patch({
          devices: home.devices,
          access: home.access,
          settings: home.settings,
          loading: false,
        });
      })
      .catch((error: unknown) => {
        useAdmin.getState().patch({ loading: false });
        useApp.getState().toast(messageOf(error));
        if (
          error instanceof Error &&
          'code' in error &&
          (error as { code?: string }).code === 'UNAUTHORIZED'
        ) {
          void logoutAdmin();
        }
      });
  }, []);
  const current = ADMIN_MENU.find(([id]) => id === tab) ?? ADMIN_MENU[0];
  return (
    <div className="admin-shell">
      <aside className="admin-nav">
        <div className="admin-brand">
          <p>보직회의</p>
          <h2>관리</h2>
        </div>
        <nav className="admin-menu" aria-label="관리 메뉴">
          {ADMIN_MENU.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? 'admin-link on' : 'admin-link'}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => useAdmin.getState().patch({ tab: id })}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="admin-nav-foot">
          <Button variant="danger" type="button" onClick={() => void logoutAdmin()}>
            관리자 해제
          </Button>
        </div>
      </aside>
      <div className="admin-page">
        <header className="admin-head">
          <h2>{current[1]}</h2>
          <p>{current[2]}</p>
        </header>
        {tab === 'meeting' && <MeetingTab />}
        {tab === 'materials' && <MaterialsTab />}
        {tab === 'access' && <AccessLogTab />}
        {tab === 'officers' && <OfficersTab />}
        {tab === 'tips' && <UsageTipTab />}
        <p className="help admin-note">
          회의 일시를 정하면 그 날짜 폴더와 본문/별첨/규정 폴더가 서버의 materials 아래에
          yy.mm.dd.로 만들어집니다. PDF는 회의자료관리에서 올리면 됩니다. 일시를 지우면 예약만
          없어지고 자료 폴더는 남습니다. 자동생성을 켜 두면 매주 월요일 오후 1시에 고른 요일과 시간의
          다음 회의와 폴더가 만들어지고, 그 날이 휴일이면 넘어갑니다. 정해 둔 회의일이 지나면
          같은 요일의 다음 회의로 바뀌고, 그 날이 휴일이면 한 주 더 넘깁니다. 보직을 고르기 전에도
          자료 목록은 받지 않습니다. 로그인한 뒤에 회의 날짜의 PDF 중 이 기기에 없거나 바뀐 것만
          받아 둡니다. 다른 날짜는 그 파일을 열 때 받습니다. 회의 시작 전 자동 확인은 하지 않습니다.
          메인 화면의 전체새로고침은 지금 열어 둔 화면의 자료 폴더를 다시 확인하게 합니다. 관리자가
          자료를 올리면 열어 둔 화면이 약 30초 안에 목록을 다시 받습니다. PDF가 아닌 파일은
          목록에 나오지 않습니다.
        </p>
      </div>
    </div>
  );
}
