import { useEffect, useState } from 'react';
import type { MemoBackupPayload } from '../../api/types';
import { listMemoBackups } from '../../db/memoBackups';
import { verifyBackup } from '../../domain/backup';
import { backupSummary, chooseBackupFolder, downloadBackup, restoreBackup, saveRetention } from '../../services/backupFlow';
import { useApp } from '../../state/app';
import { Modal } from '../common/Modal';

export function BackupPanel() {
  const open = useApp((state) => state.showBackup);
  const [summary, setSummary] = useState({ count: 0, bytes: 0, latest: '', days: 90 });
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listMemoBackups>>>([]);
  const reload = () => {
    void backupSummary().then((value) => setSummary({ ...value, latest: value.latest || '' }));
    void listMemoBackups().then(setRows);
  };
  useEffect(() => {
    if (open) reload();
  }, [open]);
  if (!open) return null;
  return (
    <Modal title="메모 백업" onClose={() => useApp.getState().patch({ showBackup: false })}>
      <p className="help">
        마지막 백업 {summary.latest || '없음'} · {summary.count}개 · {Math.ceil(summary.bytes / 1024)}KB
      </p>
      <label className="field">
        보관 기간(일)
        <input
          type="number"
          min={7}
          max={365}
          defaultValue={summary.days}
          onBlur={(event) => void saveRetention(Number(event.target.value))}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-line" type="button" onClick={() => void chooseBackupFolder()}>
          디스크 폴더 지정
        </button>
        <button
          className="btn btn-line"
          type="button"
          onClick={() => {
            const latest = rows[0];
            if (latest) downloadBackup(latest.data);
          }}
        >
          백업 파일 내려받기
        </button>
      </div>
      <h3>백업에서 복원</h3>
      {rows.map((row) => (
        <button key={row.id} className="tree-file" type="button" onClick={() => void restoreBackup(row.data)}>
          {row.createdAt} · 메모 {row.annotationCount} · {Math.ceil(row.sizeBytes / 1024)}KB
        </button>
      ))}
      <label className="field">
        JSON 파일
        <input
          type="file"
          accept="application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then(async (text) => {
              const payload = JSON.parse(text) as MemoBackupPayload;
              if (!(await verifyBackup(payload))) {
                useApp.getState().toast('백업 파일을 확인할 수 없습니다.');
                return;
              }
              await restoreBackup(payload);
            });
          }}
        />
      </label>
    </Modal>
  );
}
