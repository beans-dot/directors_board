import { useEffect, useRef, useState } from 'react';
import type { DateFolder, DriveNode } from '../../api/types';
import { listAnnotationsByFile } from '../../db/annotations';
import { listSendRecords } from '../../db/sendHistory';
import { isAllowedRecipient } from '../../domain/email';
import { sendMode } from '../../domain/capacity';
import { todayFolderDate } from '../../domain/folderDate';
import { collectPdfs, pickSendFolder } from '../../domain/paths';
import { deliver, downloadArchive, prepareFolder, type PreparedPack } from '../../services/sendFlow';
import { messageOf } from '../../services/runtime';
import { useApp } from '../../state/app';
import { useTree } from '../../state/tree';
import { useViewer } from '../../state/viewer';
import { Modal } from '../common/Modal';
import { SendPreview } from './SendPreview';
import { SendProgress } from './SendProgress';

export function SendDialog() {
  const open = useApp((state) => state.showSend);
  const profile = useApp((state) => state.profile);
  const folders = useTree((state) => state.folders);
  const config = useApp((state) => state.config);
  const openPath = useViewer((state) => state.file?.path || '');
  const [folderId, setFolderId] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [step, setStep] = useState<'form' | 'work' | 'preview'>('form');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [pack, setPack] = useState<PreparedPack | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listSendRecords>>>([]);
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
        setSubject(`[보직회의] ${picked.folderDate || today} 회의자료 및 메모`);
      }
      return;
    }
    primed.current = true;
    setFolderId(picked?.id || '');
    const officer = config?.officers?.find((item) => item.id === profile?.officerId);
    const fromOfficer = officer && isAllowedRecipient(officer.email) ? officer.email : '';
    const saved = profile?.savedEmail && isAllowedRecipient(profile.savedEmail) ? profile.savedEmail : '';
    setEmail(fromOfficer || saved);
    setSubject(`[보직회의] ${picked?.folderDate || today} 회의자료 및 메모`);
    setStep('form');
    setError('');
    void listSendRecords().then(setHistory);
  }, [open, config, folders, profile, openPath, folderId]);

  if (!open) return null;
  const folder = folders.find((item) => item.id === folderId);
  const pdfCount = folder ? collectPdfs(folder).length : 0;
  const allowed = isAllowedRecipient(email);
  const close = () => useApp.getState().patch({ showSend: false });
  const fail = (cause: unknown) => {
    setError(messageOf(cause));
    setStep('form');
  };

  return (
    <Modal title="회의종료 및 자료전송" onClose={close}>
      {step === 'form' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!folder || !allowed || pdfCount === 0) return;
            setError('');
            setStep('work');
            void prepareFolder(folder, setProgress)
              .then((prepared) => {
                if (!prepared.files.length) {
                  setError('보낼 PDF가 없습니다.');
                  setStep('form');
                  return;
                }
                setPack(prepared);
                setStep('preview');
              })
              .catch(fail);
          }}
        >
          <label className="field">
            날짜 폴더
            <select value={folderId} onChange={(event) => {
              userPicked.current = true;
              const next = folders.find((item) => item.id === event.target.value);
              setFolderId(event.target.value);
              if (next) setSubject(`[보직회의] ${next.folderDate} 회의자료 및 메모`);
            }}>
              {folders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.folderDate}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            메일 주소
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@yeonsung.ac.kr" />
            <span className="help">@yeonsung.ac.kr</span>
            {email && !allowed && <span className="help">연성대학교 메일(@yeonsung.ac.kr)만 받을 수 있습니다.</span>}
          </label>
          <label className="field">
            제목
            <input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          {folder && pdfCount === 0 && <p className="help">이 날짜 폴더에 PDF가 없습니다. 자료가 있는 날짜를 고르세요.</p>}
          {error && <p className="help" style={{ color: 'var(--danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={!allowed || !folder || pdfCount === 0}>
            다음
          </button>
          <button
            className="btn btn-line"
            type="button"
            disabled={!folder || pdfCount === 0}
            onClick={() => {
              if (!folder || pdfCount === 0) return;
              setError('');
              setStep('work');
              void prepareFolder(folder, setProgress)
                .then((prepared) => {
                  downloadArchive(prepared.archiveBytes, prepared.archiveName);
                  setStep('form');
                })
                .catch(fail);
            }}
          >
            기기에 내려받기
          </button>
          </div>
          <div className="help">내 발송 이력</div>
          {history.map((row, index) => (
            <div key={`${row.at}-${index}`} className="help">
              {row.at} {row.to} {row.ok ? '성공' : '실패'}
            </div>
          ))}
        </form>
      )}
      {step === 'work' && <SendProgress text={progress || 'PDF를 만드는 중'} />}
      {step === 'preview' && error && <p className="help" style={{ color: 'var(--danger)' }}>{error}</p>}
      {step === 'preview' && folder && pack && (
        <SendPreview
          to={email.trim()}
          subject={subject}
          files={pack.files}
          packedBytes={pack.archiveBytes.byteLength}
          mode={sendMode(pack.archiveBytes.byteLength, config?.maxAttachBytes)}
          onBack={() => setStep('form')}
          onSend={() => {
            setStep('work');
            setProgress('보내는 중');
            void sendNow(folder, email.trim(), subject, pack, setProgress)
              .then(() => close())
              .catch((cause: unknown) => {
                setError(messageOf(cause));
                setStep('preview');
              });
          }}
        />
      )}
    </Modal>
  );
}

async function sendNow(
  folder: DateFolder,
  to: string,
  subject: string,
  pack: PreparedPack,
  onProgress: (text: string) => void,
) {
  const annotations = [];
  for (const file of pack.files) {
    const nodeId = useTree.getState().folders.flatMap((item) => flattenIds(item)).find((item) => item.path === file.path);
    if (!nodeId) continue;
    const rows = await listAnnotationsByFile(nodeId.id);
    annotations.push({ topFolder: file.topFolder, name: file.name, annotations: rows });
  }
  await deliver({
    folder,
    to,
    subject,
    files: pack.files,
    archiveName: pack.archiveName,
    archiveBytes: pack.archiveBytes,
    annotationsForSummary: annotations,
    onProgress,
  });
}

function flattenIds(node: DriveNode): DriveNode[] {
  return [node, ...(node.children || []).flatMap((child) => flattenIds(child))];
}
