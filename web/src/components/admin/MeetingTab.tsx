import { useEffect, useState } from 'react';
import {
  createMaterialFolder,
  listMaterialFolders,
  loadAdminHome,
  saveMaterialMeeting,
  updateMeetingInfo,
} from '../../api/materials';
import { WEEKDAYS, monthGrid, shiftMonth } from '../../domain/calendar';
import { dateKeyToFolderDate, formatMeetingLabel, todayKey } from '../../domain/folderDate';
import { autoMeetingPlan, nextAutoRunKey } from '../../domain/krHoliday';
import { armMeetingRefresh, messageOf, refreshTree } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function MeetingTab() {
  const settings = useAdmin((state) => state.settings);
  const supported =
    settings != null && 'meetingDate' in settings && Array.isArray(settings.dateFolders);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(1);
  const [selected, setSelected] = useState('');
  const [time, setTime] = useState('09:00');
  const [title, setTitle] = useState('보직회의');
  const [autoWeekday, setAutoWeekday] = useState(1);
  const [autoTime, setAutoTime] = useState('10:00');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState<null | 'save' | 'clear'>(null);
  const [autoSaving, setAutoSaving] = useState(false);

  useEffect(() => {
    let cancel = false;
    void listMaterialFolders().then((folders) => {
      if (cancel || !folders) return;
      const current = useAdmin.getState().settings;
      if (!current) return;
      const merged = new Map((current.dateFolders || []).map((folder) => [folder.dateKey, folder]));
      for (const folder of folders) merged.set(folder.dateKey, folder);
      useAdmin.getState().patch({
        settings: {
          ...current,
          dateFolders: [...merged.values()],
          rootFolderSet: true,
          rootFolderName: 'materials',
        },
      });
    });
    return () => {
      cancel = true;
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || ready || !settings) return;
    const date = settings.meetingDate || todayKey();
    const [nextYear, nextMonth] = date.split('-').map(Number);
    setYear(nextYear);
    setMonth(nextMonth);
    setSelected(date);
    setTime(settings.meetingTime || '09:00');
    const weekday = Number(settings.meetingAutoWeekday);
    setAutoWeekday(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1);
    setAutoTime(
      /^([01]\d|2[0-3]):[0-5]\d$/.test(settings.meetingAutoTime || '')
        ? settings.meetingAutoTime || '10:00'
        : '10:00',
    );
    setReady(true);
  }, [ready, settings, supported]);

  if (!settings) return <p className="help">설정을 불러오는 중</p>;
  if (!supported) {
    return (
      <p className="help">
        회의 일시 설정은 Apps Script 배포를 새 버전으로 갱신한 뒤에 사용할 수 있습니다.
      </p>
    );
  }

  const weeks = monthGrid(year, month);
  const folderName = dateKeyToFolderDate(selected);
  const folders = settings.dateFolders || [];
  const existing = folders.find((folder) => folder.dateKey === selected);
  const currentLabel = formatMeetingLabel(settings.meetingDate || '', settings.meetingTime || '');
  const canPrev = year > 2000 || month > 1;
  const canNext = year < 2099 || month < 12;

  const move = (delta: number) => {
    const next = shiftMonth(year, month, delta);
    if (next.year < 2000 || next.year > 2099) return;
    setYear(next.year);
    setMonth(next.month);
  };

  const save = (another = false) => {
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin' || !folderName || saving) return;
    setSaving('save');
    const existed = Boolean(existing) && !another;
    void (async () => {
      const meetingFolder =
        existed && existing ? existing : await createMaterialFolder(selected, time, title);
      const result = await saveMaterialMeeting({ meetingDate: selected, meetingTime: time });
      const nextFolders = [
        meetingFolder,
        ...folders.filter((folder) => folder.folderId !== meetingFolder.folderId),
      ];
      useAdmin.getState().patch({
        settings: {
          ...settings,
          meetingDate: result.meetingDate || selected,
          meetingTime: result.meetingTime || time,
          dateFolders: nextFolders,
        },
      });
      const config = useApp.getState().config;
      if (config) {
        useApp.getState().patch({
          config: {
            ...config,
            meetingDate: result.meetingDate || selected,
            meetingTime: result.meetingTime || time,
          },
        });
        armMeetingRefresh();
      }
      const home = await loadAdminHome();
      useAdmin
        .getState()
        .patch({ settings: home.settings, devices: home.devices, access: home.access });
      await refreshTree('refresh');
      useApp
        .getState()
        .toast(
          existed
            ? `${folderName} 회의를 현재 회의로 지정했습니다.`
            : `${folderName} 회의를 만들었습니다. PDF는 회의자료관리에서 올리면 됩니다.`,
        );
    })()
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setSaving(null));
  };

  const clearMeeting = () => {
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin' || saving || !settings.meetingDate) return;
    setSaving('clear');
    void saveMaterialMeeting({ clearMeeting: true })
      .then((result) => {
        useAdmin.getState().patch({
          settings: {
            ...settings,
            meetingDate: result.meetingDate,
            meetingTime: result.meetingTime,
          },
        });
        const config = useApp.getState().config;
        if (config) {
          useApp.getState().patch({
            config: {
              ...config,
              meetingDate: result.meetingDate,
              meetingTime: result.meetingTime,
            },
          });
        }
        armMeetingRefresh();
        useApp.getState().toast('회의 일시를 지웠습니다. 자료 폴더는 그대로 둡니다.');
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setSaving(null));
  };

  const setAuto = (next: boolean) => {
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin' || autoSaving || !settings) return;
    setAutoSaving(true);
    void saveMaterialMeeting({
      meetingAuto: next,
      meetingAutoWeekday: autoWeekday,
      meetingAutoTime: autoTime,
    })
      .then((result) => {
        const meetingAuto = result.meetingAuto === true;
        useAdmin.getState().patch({
          settings: {
            ...settings,
            meetingAuto,
            meetingAutoWeekday: result.meetingAutoWeekday ?? autoWeekday,
            meetingAutoTime: result.meetingAutoTime || autoTime,
          },
        });
        useApp.getState().toast(meetingAuto ? '자동생성을 켰습니다.' : '자동생성을 껐습니다.');
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setAutoSaving(false));
  };

  const runKey = nextAutoRunKey();
  const saveAutoPlan = () => {
    if (useApp.getState().profile?.role !== 'admin' || autoSaving) return;
    setAutoSaving(true);
    void saveMaterialMeeting({ meetingAutoWeekday: autoWeekday, meetingAutoTime: autoTime })
      .then((result) => {
        const current = useAdmin.getState().settings;
        if (!current) return;
        useAdmin.getState().patch({
          settings: {
            ...current,
            meetingAutoWeekday: result.meetingAutoWeekday ?? autoWeekday,
            meetingAutoTime: result.meetingAutoTime || autoTime,
          },
        });
        useApp.getState().toast('자동으로 만들 요일과 시간을 저장했습니다.');
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setAutoSaving(false));
  };

  const autoPlan = autoMeetingPlan(runKey, autoWeekday, autoTime);
  const autoDayName = `${WEEKDAYS[autoWeekday] || '월'}요일`;
  const runLabel = formatMeetingLabel(runKey).replace(/^회의 /, '');
  const planLabel = autoPlan
    ? formatMeetingLabel(autoPlan.dateKey, autoPlan.time).replace(/^회의 /, '')
    : '';
  const autoText = planLabel
    ? `${runLabel} 오후 1시에 ${planLabel} 회의와 자료 폴더를 만듭니다.`
    : `${runLabel} 오후 1시에는 다음 ${autoDayName}이 휴일이라 만들지 않습니다.`;

  const dayMeetings = (settings.meetings || []).filter((meeting) => meeting.dateKey === selected);

  const reloadAdmin = async () => {
    const home = await loadAdminHome();
    useAdmin
      .getState()
      .patch({ settings: home.settings, devices: home.devices, access: home.access });
  };
  return (
    <div className="meeting-layout">
      <div className="admin-panel">
        <div className="cal-nav">
          <Button
            variant="line"
            type="button"
            onClick={() => move(-1)}
            disabled={!canPrev}
            aria-label="이전 달"
          >
            이전
          </Button>
          <strong>
            {year}년 {month}월
          </strong>
          <Button
            variant="line"
            type="button"
            onClick={() => move(1)}
            disabled={!canNext}
            aria-label="다음 달"
          >
            다음
          </Button>
        </div>
        <div className="cal-grid" role="grid" aria-label="보직회의 날짜">
          {WEEKDAYS.map((label, index) => (
            <div
              key={label}
              className={`cal-wd ${index === 0 ? 'sun' : ''} ${index === 6 ? 'sat' : ''}`}
              role="columnheader"
            >
              {label}
            </div>
          ))}
          {weeks.flat().map((day, index) => {
            const column = index % 7;
            const hasFolder = folders.some((folder) => folder.dateKey === day.dateKey);
            const on = day.dateKey === selected;
            return (
              <button
                key={day.dateKey}
                type="button"
                role="gridcell"
                aria-selected={on}
                aria-label={`${day.dateKey}${hasFolder ? ', 자료 폴더 있음' : ''}`}
                className={`cal-day ${day.inMonth ? '' : 'out'} ${column === 0 ? 'sun' : ''} ${column === 6 ? 'sat' : ''} ${on ? 'on' : ''}`}
                onClick={() => {
                  if (!dateKeyToFolderDate(day.dateKey)) return;
                  setSelected(day.dateKey);
                  if (!day.inMonth) {
                    const [nextYear, nextMonth] = day.dateKey.split('-').map(Number);
                    setYear(nextYear);
                    setMonth(nextMonth);
                  }
                }}
              >
                {day.day}
                {hasFolder && <span className="dot" />}
              </button>
            );
          })}
        </div>
        <p className="help">점이 있는 날은 자료 폴더가 이미 있습니다.</p>
      </div>
      <div className="card">
        {'meetingAuto' in settings ? (
          <>
            <div className="auto-row">
              <button
                type="button"
                className={settings.meetingAuto ? 'switch on' : 'switch'}
                aria-pressed={settings.meetingAuto === true}
                aria-label="자동생성"
                disabled={autoSaving}
                onClick={() => setAuto(settings.meetingAuto !== true)}
              >
                <i />
              </button>
              <strong>자동생성</strong>
            </div>
            <p className="help">
              켜 두면 매주 월요일 오후 1시에, 고른 요일과 시간의 다음 회의와 자료 폴더를 만듭니다.
              그 날이 공휴일이나 대체공휴일이면 만들지 않습니다. 임시공휴일은 포함되지 않습니다.
            </p>
            <div className="auto-plan">
              <label className="field">
                만들 요일
                <select
                  value={autoWeekday}
                  disabled={autoSaving}
                  onChange={(event) => setAutoWeekday(Number(event.target.value))}
                >
                  {WEEKDAYS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}요일
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                만들 시간
                <input
                  type="time"
                  value={autoTime}
                  disabled={autoSaving}
                  onChange={(event) => setAutoTime(event.target.value)}
                />
              </label>
              <Button variant="line" type="button" onClick={saveAutoPlan} disabled={autoSaving}>
                요일과 시간 저장
              </Button>
            </div>
            {settings.meetingAuto && <p className="help">{autoText}</p>}
          </>
        ) : (
          <p className="help">
            자동생성은 Apps Script 배포를 새 버전으로 갱신한 뒤에 사용할 수 있습니다.
          </p>
        )}
        <p>
          {currentLabel
            ? `현재 회의 ${currentLabel.replace(/^회의 /, '')}`
            : '아직 지정된 회의가 없습니다.'}
        </p>
        <p>
          선택 {folderName || '없음'}
          {existing ? ' · 폴더 있음' : ''}
        </p>
        <label className="field">
          회의 시간
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="field">
          회의 이름
          <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="meeting-actions">
          <Button
            variant="primary"
            type="button"
            onClick={() => save(false)}
            disabled={!folderName || saving !== null}
          >
            {saving === 'save' ? '만드는 중' : existing ? '이 일시로 지정' : '이 날짜 폴더 만들기'}
          </Button>
          {existing && (
            <Button
              variant="line"
              type="button"
              onClick={() => save(true)}
              disabled={saving !== null}
            >
              같은 날짜에 회의 하나 더
            </Button>
          )}
          {settings.meetingDate && (
            <Button
              variant="danger"
              type="button"
              onClick={clearMeeting}
              disabled={saving !== null}
            >
              {saving === 'clear' ? '지우는 중' : '회의 일시 삭제'}
            </Button>
          )}
        </div>
        <p className="help">
          자료 폴더 이름은 26.11.12.처럼 날짜만 사용합니다. PDF는 회의자료관리에서 올립니다.
        </p>
        {dayMeetings.map((meeting) => (
          <div className="meeting-info" key={meeting.id}>
            <span>
              {meeting.folderDate} {meeting.time} {meeting.title}
            </span>
            <Button
              variant="line"
              type="button"
              disabled={saving !== null}
              onClick={() => {
                void updateMeetingInfo(meeting.id, time, title || meeting.title)
                  .then(() => reloadAdmin())
                  .then(() => useApp.getState().toast('회의 정보를 수정했습니다.'))
                  .catch((error: unknown) => useApp.getState().toast(messageOf(error)));
              }}
            >
              이 회의 정보 저장
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
