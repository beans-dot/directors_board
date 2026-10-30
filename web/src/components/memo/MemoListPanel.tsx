import { useState } from 'react';
import { listRevisions } from '../../db/annotations';
import type { Annotation, AnnotationRevision, DriveNode } from '../../api/types';
import { pinsInNumberOrder } from '../../domain/pinNumbers';
import { openPdf, saveMemo } from '../../services/runtime';
import { MemoSearchBox } from '../search/MemoSearchBox';
import { useApp } from '../../state/app';
import { useMemoStore } from '../../state/memo';
import { useTree } from '../../state/tree';
import { useViewer } from '../../state/viewer';

function deleteMemo(ann: Annotation) {
  void saveMemo({ ...ann, status: 'deleted', version: ann.version + 1, updatedAt: new Date().toISOString() }, 'delete');
}

function fileNameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || '자료';
}

function findDriveNode(node: DriveNode, id: string): DriveNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findDriveNode(child, id);
    if (found) return found;
  }
  return null;
}

interface FileGroup {
  fileId: string;
  label: string;
  anns: Annotation[];
}

function groupsByFile(visible: Annotation[], openFileId: string | null): FileGroup[] {
  const byFile = new Map<string, Annotation[]>();
  visible.forEach((ann) => {
    const list = byFile.get(ann.driveFileId) ?? [];
    list.push(ann);
    byFile.set(ann.driveFileId, list);
  });
  const nameCount = new Map<string, number>();
  byFile.forEach((anns) => {
    const name = fileNameOf(anns[0]?.path || '');
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  });
  const groups = [...byFile.entries()].map(([fileId, anns]) => {
    const name = fileNameOf(anns[0]?.path || '');
    const parts = (anns[0]?.path || '').split('/').filter(Boolean);
    const label = (nameCount.get(name) ?? 0) > 1 ? parts.slice(1).join('/') || name : name;
    return { fileId, label, anns };
  });
  groups.sort((a, b) => {
    if (openFileId && a.fileId === openFileId) return -1;
    if (openFileId && b.fileId === openFileId) return 1;
    return a.label.localeCompare(b.label, 'ko');
  });
  return groups;
}

async function openMemo(ann: Annotation) {
  const current = useViewer.getState().file;
  if (current?.id !== ann.driveFileId) {
    const folder = useTree.getState().folders.find((item) => item.folderDate === ann.folderDate);
    const node = folder ? findDriveNode(folder, ann.driveFileId) : null;
    if (!node?.isPdf) return;
    await openPdf(node, false, ann.page);
    if (useViewer.getState().file?.id !== ann.driveFileId) return;
  } else {
    useViewer.getState().patch({ page: ann.page });
  }
  useMemoStore.getState().patch({ activeId: ann.id, editorId: ann.id });
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M5 7h14M9 7V4.5h6V7M7.5 7l.8 12.5h7.4L16.5 7M10 10.5v6M14 10.5v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MemoListPanel() {
  const open = useApp((state) => state.memoOpen);
  const items = useMemoStore((state) => state.items);
  const showDeleted = useMemoStore((state) => state.showDeleted);
  const openFileId = useViewer((state) => state.file?.id ?? null);
  const visible = items.filter((ann) => ann.type === 'pin' && (showDeleted ? ann.status === 'deleted' : ann.status === 'active'));
  const [history, setHistory] = useState<AnnotationRevision[]>([]);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const fileGroups = groupsByFile(visible, openFileId);
  return (
    <aside className={`memo-list ${open ? '' : 'closed'}`}>
      <button className="btn btn-line btn-sm memo-list-toggle" type="button" onClick={() => useApp.getState().patch({ memoOpen: !open })}>
        {open ? '내 메모 ▸' : '내 메모'}
      </button>
      {open && <MemoSearchBox />}
      {open && (
        <div className="memo-list-body">
          {fileGroups.map((group) => {
            const collapsed = folded[group.fileId] === true;
            const pages = new Map<number, Annotation[]>();
            group.anns.forEach((ann) => {
              const list = pages.get(ann.page) ?? [];
              list.push(ann);
              pages.set(ann.page, list);
            });
            return (
              <div key={group.fileId}>
                <button
                  className="memo-file"
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() => setFolded((state) => ({ ...state, [group.fileId]: state[group.fileId] !== true }))}
                >
                  <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                  <span className="memo-file-name">{group.label}</span>
                </button>
                {!collapsed &&
                  [...pages.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([page, anns]) => (
                      <div key={page}>
                        <div className="help">{page}쪽</div>
                        {pinsInNumberOrder(anns).map((ann, index) => (
                          <div key={ann.id} className="memo-row">
                            <button className="memo-row-open" type="button" onClick={() => void openMemo(ann)}>
                              {!showDeleted && <span className="memo-num">{index + 1}</span>}
                              <span className="memo-row-text">{ann.content || '메모'}</span>
                            </button>
                            {!showDeleted && (
                              <button className="memo-trash" type="button" aria-label="메모 삭제" title="삭제" onClick={() => deleteMemo(ann)}>
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
              </div>
            );
          })}
          <button className="tiny-link" type="button" onClick={() => useMemoStore.getState().patch({ showDeleted: !showDeleted })}>
            {showDeleted ? '메모 목록' : '삭제한 메모 보기'}
          </button>
          {showDeleted &&
            visible.map((ann) => (
              <div key={ann.id}>
                <button
                  className="btn btn-line btn-sm"
                  type="button"
                  onClick={() => void saveMemo({ ...ann, status: 'active', version: ann.version + 1, updatedAt: new Date().toISOString() }, 'restore')}
                >
                  복원
                </button>
                <button className="tiny-link" type="button" onClick={() => void listRevisions(ann.id).then(setHistory)}>
                  이력
                </button>
              </div>
            ))}
          {history.map((rev, index) => (
            <div key={`${rev.annotationId}-${index}`} className="help">
              {rev.action} · {rev.at}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
