import { useEffect, useRef, useState } from 'react';
import type { DateFolder } from '../../api/types';
import { meetingZipName, todayFolderDate } from '../../domain/folderDate';
import { collectPdfs, pickSendFolder } from '../../domain/paths';
import { downloadMeetingZip } from '../../api/materials';
import { messageOf, syncMemosBeforeDownload } from '../../services/runtime';
import { useApp } from '../../state/app';
import { useTree } from '../../state/tree';
import { useViewer } from '../../state/viewer';
import { Modal } from '../common/Modal';
import { SendProgress } from './SendProgress';

export function SendDialog() {
  const open = useApp((state) => state.showSend);
  const folders = useTree((state) => state.folders);
  const config = useApp((state) => state.config);
  const openPath = useViewer((state) => state.file?.path || '');
  const [folderId, setFolderId] = useState('');
  const [step, setStep] = useState<'form' | 'work'>('form');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const primed = useRef(false);
  const userPicked = useRef(false);

  useEffect(() => {
    if (!open) {
      primed.current = false;
      userPicked.current = false;
      return;
    }
    if (!folders.length) return;
    const today = config?.today || todayFolderDate();
    const picked = pickSendFolder(folders, openPath, today);
    const current = folders.find((item) => item.id === folderId);
    const currentCount = current ? collectPdfs(current).length : 0;
    const pickedCount = picked ? collectPdfs(picked).length : 0;
    if (primed.current) {
      if (!userPicked.current && currentCount === 0 && pickedCount > 0 && picked && picked.id !== folderId) {
        setFolderId(picked.id);
      }
      return;
    }
    primed.current = true;
    setFolderId(picked?.id || '');
    setStep('form');
    setError('');
  }, [open, config, folders, openPath, folderId]);

  if (!open) return null;
  const folder = folders.find((item) => item.id === folderId);
  const pdfCount = folder ? collectPdfs(folder).length : 0;
  const close = () => useApp.getState().patch({ showSend: false });
  const fail = (cause: unknown) => {
    setError(messageOf(cause));
    setStep('form');
  };
  const download = (target: DateFolder) => {
    setError('');
    setStep('work');
    setProgress('메모를 저장하는 중');
    void syncMemosBeforeDownload()
      .then(() => {
        setProgress('서버에서 메모를 입히는 중');
        return downloadMeetingZip(target.id, meetingZipName(target.dateKey, target.folderDate));
      })
      .then(() => {
        useApp.getState().toast('회의자료를 내려받았습니다.');
        close();
      })
      .catch(fail);
  };

  return (
    <Modal title="전체 회의자료 내려받기" onClose={close}>
      {step === 'form' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!folder || pdfCount === 0) return;
            download(folder);
          }}
        >
          <label className="field">
            날짜 폴더
            <select
              value={folderId}
              onChange={(event) => {
                userPicked.current = true;
                setFolderId(event.target.value);
              }}
            >
              {folders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.folderDate}
                </option>
              ))}
            </select>
          </label>
          <p className="help">이 계정의 메모가 들어간 PDF를 압축해서 내려받습니다. 메모가 없는 자료는 원본 그대로 들어갑니다.</p>
          {folder && pdfCount === 0 && <p className="help">이 날짜 폴더에 PDF가 없습니다. 자료가 있는 날짜를 고르세요.</p>}
          {error && <p className="help" style={{ color: 'var(--danger)' }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={!folder || pdfCount === 0}>
            내려받기
          </button>
        </form>
      )}
      {step === 'work' && <SendProgress text={progress || 'PDF를 만드는 중'} />}
    </Modal>
  );
}
