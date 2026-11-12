import { useRef, useState } from 'react';
import {
  createMaterialFolder,
  deleteMaterialFile,
  deleteMaterialFolder,
  loadAdminHome,
  reorderMaterialFiles,
  replaceMaterialPdf,
  uploadMaterialPdf,
} from '../../api/materials';
import type { AdminSettings, MeetingFileRecord, MeetingRecord } from '../../api/types';
import { dateKeyToFolderDate, formatMeetingLabel, parseDateInput } from '../../domain/folderDate';
import { messageOf, refreshTree } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

const BUCKETS = ['본문', '별첨', '규정'] as const;

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 1024) return `${Math.max(0, Math.round(size || 0))}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

function filesInBucket(meeting: MeetingRecord, bucket: string) {
  return meeting.files
    .filter((file) => file.category === bucket)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
}

function folderChoices(settings: AdminSettings) {
  const map = new Map<string, { folderDate: string; dateKey: string; folderId: string }>();
  for (const folder of settings.dateFolders || []) {
    if (!dateKeyToFolderDate(folder.dateKey)) continue;
    map.set(folder.dateKey, folder);
  }
  for (const meeting of settings.meetings || []) {
    if (map.has(meeting.dateKey) || !dateKeyToFolderDate(meeting.dateKey)) continue;
    map.set(meeting.dateKey, {
      folderDate: meeting.folderDate,
      dateKey: meeting.dateKey,
      folderId: meeting.id,
    });
  }
  return [...map.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export function MaterialsTab() {
  const settings = useAdmin((state) => state.settings);
  const [picked, setPicked] = useState('');
  const [uploadBucket, setUploadBucket] = useState<string | null>(null);
  const [dragBucket, setDragBucket] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const orderDrag = useRef<{ id: string; meetingId: string; bucket: string } | null>(null);
  const [targetMeetingId, setTargetMeetingId] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [dateText, setDateText] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDate, setConfirmDate] = useState('');

  if (!settings) return <p className="help">설정을 불러오는 중</p>;

  const folders = folderChoices(settings);
  const selected =
    folders.find((folder) => folder.dateKey === picked) ||
    folders.find((folder) => folder.dateKey === settings.meetingDate) ||
    folders[0];
  const dayMeetings = (settings.meetings || []).filter(
    (meeting) => meeting.dateKey === selected?.dateKey,
  );
  const targetId =
    dayMeetings.find((meeting) => meeting.id === targetMeetingId)?.id ||
    dayMeetings.find(
      (meeting) =>
        settings.meetingDate === selected?.dateKey && meeting.time === settings.meetingTime,
    )?.id ||
    dayMeetings[0]?.id ||
    selected?.folderId ||
    '';
  const locked = uploadBucket !== null || fileBusy || creating || deleting;
  const confirming = confirmDate !== '' && confirmDate === selected?.dateKey;
  const scheduledHere = settings.meetingDate === selected?.dateKey;

  const createFolder = () => {
    const profile = useApp.getState().profile;
    const dateKey = parseDateInput(dateText);
    if (profile?.role !== 'admin' || creating) return;
    if (!dateKey) {
      useApp.getState().toast('날짜를 2026-11-12 또는 26.11.12. 형식으로 입력해 주세요.');
      return;
    }
    const folderName = dateKeyToFolderDate(dateKey);
    if (folders.some((folder) => folder.dateKey === dateKey)) {
      setPicked(dateKey);
      useApp.getState().toast(`${folderName} 폴더는 이미 있습니다.`);
      return;
    }
    setCreating(true);
    void createMaterialFolder(dateKey, '10:00', '보직회의', { folderOnly: true })
      .then(async (created) => {
        await reloadAdmin();
        setPicked(created.dateKey || dateKey);
        setDateText('');
        useApp
          .getState()
          .toast(
            created.existed
              ? `${created.folderDate} 폴더는 이미 있습니다.`
              : `${created.folderDate} 폴더를 만들었습니다. 본문, 별첨, 규정이 함께 있습니다.`,
          );
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setCreating(false));
  };

  const removeFolder = () => {
    const profile = useApp.getState().profile;
    if (!selected || locked) return;
    if (profile?.role !== 'admin') {
      useApp.getState().toast('관리자로 다시 전환해 주세요.');
      return;
    }
    if (!confirming) {
      setConfirmDate(selected.dateKey);
      return;
    }
    const dateKey = selected.dateKey;
    const folderDate = selected.folderDate;
    setDeleting(true);
    void deleteMaterialFolder(dateKey)
      .then(async (result) => {
        await reloadAdmin();
        setPicked('');
        setTargetMeetingId('');
        setConfirmDate('');
        const config = useApp.getState().config;
        if (result.clearedSchedule && config) {
          useApp.getState().patch({ config: { ...config, meetingDate: '', meetingTime: '' } });
        }
        useApp
          .getState()
          .toast(
            result.clearedSchedule
              ? `${result.folderDate || folderDate} 폴더를 삭제하고, 그 날짜로 잡혀 있던 회의 일시도 해제했습니다. 개인 메모는 계정에 남아 있습니다.`
              : `${result.folderDate || folderDate} 폴더를 삭제했습니다. 개인 메모는 계정에 남아 있습니다.`,
          );
        void refreshTree('refresh').catch(() => undefined);
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setDeleting(false));
  };
  const dateLabel = selected ? formatMeetingLabel(selected.dateKey).replace(/^회의 /, '') : '';

  const reloadAdmin = async () => {
    const home = await loadAdminHome();
    useAdmin
      .getState()
      .patch({ settings: home.settings, devices: home.devices, access: home.access });
  };

  const uploadFiles = (files: File[], bucket: string) => {
    const profile = useApp.getState().profile;
    const pdfs = files.filter(isPdfFile);
    if (!files.length || locked) return;
    if (profile?.role !== 'admin') {
      useApp.getState().toast('관리자로 다시 전환해 주세요.');
      return;
    }
    if (!targetId) {
      useApp.getState().toast('자료 폴더를 먼저 만들어 주세요.');
      return;
    }
    if (!pdfs.length) {
      useApp.getState().toast('PDF만 올릴 수 있습니다.');
      return;
    }
    setUploadBucket(bucket);
    void (async () => {
      for (const file of pdfs) await uploadMaterialPdf(file, targetId, bucket);
      await reloadAdmin();
      await refreshTree('refresh');
      const skipped = files.length - pdfs.length;
      useApp
        .getState()
        .toast(
          skipped
            ? `${pdfs.length}개 PDF를 ${bucket}에 올렸습니다. PDF가 아닌 파일은 건너뛰었습니다.`
            : `${pdfs.length}개 PDF를 ${bucket}에 올렸습니다.`,
        );
    })()
      .catch((error: unknown) => {
        useApp.getState().toast(error instanceof Error ? error.message : '올리지 못했습니다.');
      })
      .finally(() => setUploadBucket(null));
  };

  const reorderFiles = (meeting: MeetingRecord, bucket: string, fromId: string, toId: string) => {
    if (locked || !fromId || fromId === toId) return;
    const ids = filesInBucket(meeting, bucket).map((item) => item.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    setFileBusy(true);
    void reorderMaterialFiles(ids)
      .then(() => reloadAdmin())
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setFileBusy(false));
  };

  const replaceFile = (file: MeetingFileRecord, next: File | undefined) => {
    if (!next || locked) return;
    if (!isPdfFile(next)) {
      useApp.getState().toast('PDF만 올릴 수 있습니다.');
      return;
    }
    setFileBusy(true);
    void replaceMaterialPdf(next, file.id)
      .then(() => reloadAdmin())
      .then(() => refreshTree('refresh'))
      .then(() => useApp.getState().toast('자료를 교체했습니다. 개인 메모는 같은 자료에 남습니다.'))
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setFileBusy(false));
  };

  const removeFile = (file: MeetingFileRecord) => {
    if (locked) return;
    setFileBusy(true);
    void deleteMaterialFile(file.id)
      .then(() => reloadAdmin())
      .then(() => refreshTree('refresh'))
      .then(() => useApp.getState().toast('자료를 삭제했습니다. 개인 메모는 계정에 남아 있습니다.'))
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setFileBusy(false));
  };

  return (
    <div className="materials-panel">
      <form
        className="materials-create"
        onSubmit={(event) => {
          event.preventDefault();
          createFolder();
        }}
      >
        <label className="field">
          새 자료 폴더
          <input
            value={dateText}
            placeholder="2026-11-12"
            aria-label="새 자료 폴더 날짜"
            disabled={locked}
            onChange={(event) => setDateText(event.target.value)}
          />
        </label>
        <Button variant="primary" type="submit" disabled={locked}>
          {creating ? '만드는 중' : '폴더 만들기'}
        </Button>
      </form>
      <p className="help">
        2026-11-12, 2026.11.12, 26.11.12.처럼 입력하면 26.11.12. 폴더와 본문, 별첨, 규정이
        만들어집니다.
      </p>
      {!selected ? (
        <p className="help">만든 폴더가 없으면 위에서 날짜를 입력해 폴더를 만듭니다.</p>
      ) : (
        <>
          <div className="materials-folder-row">
            <label className="field materials-folder">
              자료 폴더
              <select
                value={selected.dateKey}
                disabled={locked}
                onChange={(event) => {
                  setPicked(event.target.value);
                  setTargetMeetingId('');
                  setConfirmDate('');
                }}
              >
                {folders.map((folder) => (
                  <option key={folder.dateKey} value={folder.dateKey}>
                    {folder.folderDate}
                  </option>
                ))}
              </select>
            </label>
            {confirming ? (
              <div className="materials-delete">
                <p className="help">
                  {selected.folderDate} 폴더와 그 안의 PDF를 지웁니다. 개인 메모는 계정에 남습니다.
                  {scheduledHere ? ' 이 날짜로 잡혀 있는 회의 일시도 해제됩니다.' : ''}
                </p>
                <Button variant="danger" type="button" disabled={locked} onClick={removeFolder}>
                  {deleting ? '삭제 중' : '삭제 확인'}
                </Button>
                <Button
                  variant="line"
                  type="button"
                  disabled={locked}
                  onClick={() => setConfirmDate('')}
                >
                  취소
                </Button>
              </div>
            ) : (
              <Button variant="danger" type="button" disabled={locked} onClick={removeFolder}>
                이 폴더 삭제
              </Button>
            )}
          </div>
          {dateLabel && <p>{dateLabel}</p>}
          {dayMeetings.length > 1 && (
            <label className="field materials-folder">
              자료를 넣을 회의
              <select
                value={targetId}
                onChange={(event) => setTargetMeetingId(event.target.value)}
                disabled={locked}
              >
                {dayMeetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meeting.time} {meeting.title || '이름 없음'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="material-buckets">
            {BUCKETS.map((bucket) => {
              const groups = dayMeetings
                .map((meeting) => ({ meeting, files: filesInBucket(meeting, bucket) }))
                .filter((group) => group.files.length > 0);
              const count = groups.reduce((sum, group) => sum + group.files.length, 0);
              return (
                <section className="material-bucket" key={bucket} aria-label={bucket}>
                  <header>
                    <strong>{bucket}</strong>
                    <span>{count}개</span>
                  </header>
                  <label
                    className={dragBucket === bucket ? 'material-drop on' : 'material-drop'}
                    onDragOver={(event) => {
                      if (orderDrag.current) return;
                      event.preventDefault();
                      if (!locked) setDragBucket(bucket);
                    }}
                    onDragLeave={() =>
                      setDragBucket((current) => (current === bucket ? '' : current))
                    }
                    onDrop={(event) => {
                      if (orderDrag.current) return;
                      event.preventDefault();
                      setDragBucket('');
                      uploadFiles([...event.dataTransfer.files], bucket);
                    }}
                  >
                    <input
                      aria-label={`${bucket}에 PDF 올리기`}
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      disabled={locked}
                      onChange={(event) => {
                        const files = event.target.files ? [...event.target.files] : [];
                        event.target.value = '';
                        uploadFiles(files, bucket);
                      }}
                    />
                    <span>
                      {uploadBucket === bucket ? '올리는 중' : 'PDF를 여기에 놓거나 선택'}
                    </span>
                  </label>
                  {groups.length === 0 ? (
                    <p className="help">올린 자료가 없습니다.</p>
                  ) : (
                    groups.map(({ meeting, files }) => (
                      <div key={meeting.id}>
                        {dayMeetings.length > 1 && (
                          <p className="material-meeting">
                            {meeting.time} {meeting.title || '이름 없음'}
                          </p>
                        )}
                        <ul className="material-files">
                          {files.map((file) => (
                            <li
                              className={draggingId === file.id ? 'material-file dragging' : 'material-file'}
                              key={file.id}
                              draggable={!locked}
                              onDragStart={(event) => {
                                if ((event.target as HTMLElement).closest('.material-file-actions')) {
                                  event.preventDefault();
                                  return;
                                }
                                orderDrag.current = { id: file.id, meetingId: meeting.id, bucket };
                                setDraggingId(file.id);
                                event.dataTransfer?.setData('text/plain', file.id);
                                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => {
                                orderDrag.current = null;
                                setDraggingId('');
                              }}
                              onDragOver={(event) => {
                                if (!orderDrag.current || orderDrag.current.meetingId !== meeting.id || orderDrag.current.bucket !== bucket) return;
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const from = orderDrag.current;
                                orderDrag.current = null;
                                setDraggingId('');
                                if (!from || from.meetingId !== meeting.id || from.bucket !== bucket) return;
                                reorderFiles(meeting, bucket, from.id, file.id);
                              }}
                            >
                              <span className="material-file-name">
                                <span className="material-file-title">{file.name}</span>
                                <small>{formatBytes(file.size)}</small>
                              </span>
                              <span className="material-file-actions">
                                <label className="btn btn-line btn-sm">
                                  변경
                                  <input
                                    aria-label={`${file.name} 변경`}
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    hidden
                                    disabled={locked}
                                    onChange={(event) => {
                                      const next = event.target.files?.[0];
                                      event.target.value = '';
                                      replaceFile(file, next);
                                    }}
                                  />
                                </label>
                                <button
                                  className="btn btn-line btn-sm"
                                  type="button"
                                  aria-label={`${file.name} 삭제`}
                                  disabled={locked}
                                  onClick={() => removeFile(file)}
                                >
                                  삭제
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </section>
              );
            })}
          </div>
          <p className="help">
            PDF만 올릴 수 있습니다. 같은 이름의 자료는 교체로 바꿉니다. 자료를 지워도 개인 메모는
            계정에 남고, 원본만 보관함으로 옮겨집니다.
          </p>
        </>
      )}
    </div>
  );
}
