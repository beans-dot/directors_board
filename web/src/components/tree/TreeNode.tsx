import type { DriveNode } from '../../api/types';
import { showFileChangeAlert } from '../../domain/changeNotice';
import { countActiveByFile } from '../../db/annotations';
import { openPdf } from '../../services/runtime';
import { beginPdfDrag, endPdfDrag, pdfDragPayload, PDF_DRAG_MIME } from '../../domain/pdfDrag';
import { useApp } from '../../state/app';
import { useTree } from '../../state/tree';
import { Badge } from '../common/Badge';
import { useEffect, useState, type CSSProperties } from 'react';

export function TreeNode({ node, depth }: { node: DriveNode; depth: number }) {
  const expanded = useTree((state) => !!state.expanded[node.id]);
  const selected = useTree((state) => state.selectedId === node.id);
  const isNew = useTree((state) => state.newFileIds.includes(node.id) || state.newFolderIds.includes(node.id));
  const replaced = useTree((state) => state.replacedIds.includes(node.id));
  const seen = useTree((state) => state.seenFolderIds.includes(node.id) || state.seenFileIds.includes(node.id));
  const localVersion = useTree((state) => state.localVersion);
  const isAdmin = useApp((state) => showFileChangeAlert(state.profile?.role));
  const [memos, setMemos] = useState(0);

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
  const hasMeta = memos > 0 || (isNew && !seen) || (isAdmin && replaced);

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
        <FileMark />
        <span className="tree-label">{label}</span>
        {hasMeta && <span className="tree-meta">
          {memos > 0 && <span>✎{memos}</span>}
          {isNew && !seen && <Badge>새 자료</Badge>}
          {isAdmin && replaced && <Badge tone="warn">바뀜</Badge>}
        </span>}
      </button>
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

function FileMark() {
  return (
    <svg className="tree-ico file" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.8h5.1L12.8 5.4V14H4V1.8Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.8V5.5h3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
