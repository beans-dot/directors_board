import type { DriveNode } from '../../api/types';
import { changeNoticeMatches, showFileChangeAlert } from '../../domain/changeNotice';
import { countActiveByFile } from '../../db/annotations';
import { openPdf, setChangeNotice } from '../../services/runtime';
import { beginPdfDrag, endPdfDrag, pdfDragPayload, PDF_DRAG_MIME } from '../../domain/pdfDrag';
import { useApp } from '../../state/app';
import { useTree } from '../../state/tree';
import { Badge } from '../common/Badge';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export function TreeNode({ node, depth }: { node: DriveNode; depth: number }) {
  const expanded = useTree((state) => !!state.expanded[node.id]);
  const selected = useTree((state) => state.selectedId === node.id);
  const isNew = useTree((state) => state.newFileIds.includes(node.id) || state.newFolderIds.includes(node.id));
  const replaced = useTree((state) => state.replacedIds.includes(node.id));
  const seen = useTree((state) => state.seenFolderIds.includes(node.id) || state.seenFileIds.includes(node.id));
  const stored = useTree((state) => node.kind === 'file' && !!state.localFiles[node.id]);
  const localVersion = useTree((state) => state.localVersion);
  const notices = useTree((state) => state.changeNotices);
  const isAdmin = useApp((state) => showFileChangeAlert(state.profile?.role));
  const [memos, setMemos] = useState(0);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const [savingNotice, setSavingNotice] = useState(false);
  const settingsRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (node.kind !== 'file' || !node.isPdf) return;
    let live = true;
    void countActiveByFile(node.id).then((count) => {
      if (live) setMemos(count);
    });
    return () => {
      live = false;
    };
  }, [node.id, node.kind, node.isPdf, localVersion]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (node.kind === 'file' && !node.isPdf) return null;

  const rowStyle = { '--depth': depth } as CSSProperties;

  if (node.kind === 'folder') {
    const folderButton = (
      <button
        className="tree-item"
        type="button"
        style={rowStyle}
        aria-expanded={expanded}
        onClick={() => useTree.getState().toggle(node.id)}
      >
        <Twist open={expanded} />
        {depth > 0 && <FolderMark />}
        <span className="tree-label">{node.name}</span>
        {isNew && !seen && (
          <span className="tree-meta">
            <Badge>새 자료</Badge>
          </span>
        )}
      </button>
    );
    return (
      <div className={depth === 0 ? 'tree-date' : 'tree-branch'}>
        {folderButton}
        {expanded && node.children && (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const label = node.name.replace(/\.pdf$/i, '');
  const noticed = changeNoticeMatches(notices, node);

  return (
    <div className={`tree-file-row${selected ? ' on' : ''}`}>
      <button
        className={`tree-file ${selected ? 'on' : ''} ${node.isPdf ? '' : 'dim'}`}
        type="button"
        style={rowStyle}
        draggable={node.isPdf}
        title={node.isPdf ? label : 'PDF만 열람 가능'}
        onClick={() => {
          if (!node.isPdf) return;
          void openPdf(node);
        }}
        onDragStart={(event) => {
          if (!node.isPdf) return;
          beginPdfDrag(node);
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData(PDF_DRAG_MIME, pdfDragPayload(node));
          event.dataTransfer.setData('text/plain', label);
        }}
        onDragEnd={() => endPdfDrag()}
      >
        <span className="tree-twist spacer" aria-hidden="true" />
        <FileMark />
        <span className="tree-label">{label}</span>
        <span className="tree-meta">
          <span className={stored ? 'tree-state local' : 'tree-state'}>{stored ? '✓' : '☁'}</span>
          {memos > 0 && <span>✎{memos}</span>}
          {isNew && !seen && <Badge>새 자료</Badge>}
          {isAdmin && replaced && <Badge tone="warn">바뀜</Badge>}
        </span>
      </button>
      {isAdmin && node.isPdf && (
        <button
          ref={settingsRef}
          className={`tree-settings${noticed ? ' on' : ''}`}
          type="button"
          aria-label={`${label} 설정`}
          aria-haspopup="menu"
          aria-expanded={menu ? true : false}
          title={noticed ? '변경 알림 켜짐' : '설정'}
          onClick={(event) => {
            event.stopPropagation();
            if (menu) {
              setMenu(null);
              return;
            }
            const rect = settingsRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = 160;
            setMenu({
              top: rect.bottom + 4,
              left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
            });
          }}
        >
          <GearMark />
        </button>
      )}
      {menu &&
        createPortal(
          <div
            className="tree-menu"
            role="menu"
            style={{ top: menu.top, left: menu.left }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              disabled={savingNotice}
              onClick={() => {
                setSavingNotice(true);
                void setChangeNotice(node, !noticed).finally(() => {
                  setSavingNotice(false);
                  setMenu(null);
                });
              }}
            >
              {noticed ? '변경알림 해제' : '변경알림'}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Twist({ open }: { open: boolean }) {
  return <span className={`tree-twist ${open ? 'open' : ''}`} aria-hidden="true" />;
}

function FolderMark() {
  return (
    <svg className="tree-ico folder" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.8 5.2c0-.8.7-1.5 1.5-1.5h2.4l1.1 1.2h5.9c.8 0 1.5.7 1.5 1.5v6.1c0 .8-.7 1.5-1.5 1.5H3.3c-.8 0-1.5-.7-1.5-1.5V5.2Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M1.8 5.2c0-.8.7-1.5 1.5-1.5h2.4l1.1 1.2h5.9c.8 0 1.5.7 1.5 1.5v6.1c0 .8-.7 1.5-1.5 1.5H3.3c-.8 0-1.5-.7-1.5-1.5V5.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function GearMark() {
  return (
    <svg className="tree-ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.7v1.7M8 12.6v1.7M1.7 8h1.7M12.6 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileMark() {
  return (
    <svg className="tree-ico file" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.8h5.1L12.8 5.4V14H4V1.8Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.8V5.5h3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
