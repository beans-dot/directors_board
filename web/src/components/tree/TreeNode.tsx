import type { DriveNode } from '../../api/types';
import { countActiveByFile } from '../../db/annotations';
import { getFile } from '../../db/files';
import { openPdf } from '../../services/runtime';
import { useTree } from '../../state/tree';
import { Badge } from '../common/Badge';
import { useEffect, useState } from 'react';

export function TreeNode({ node, depth }: { node: DriveNode; depth: number }) {
  const expanded = useTree((state) => !!state.expanded[node.id]);
  const selected = useTree((state) => state.selectedId === node.id);
  const isNew = useTree((state) => state.newFileIds.includes(node.id) || state.newFolderIds.includes(node.id));
  const replaced = useTree((state) => state.replacedIds.includes(node.id));
  const seen = useTree((state) => state.seenFolderIds.includes(node.id) || state.seenFileIds.includes(node.id));
  const localVersion = useTree((state) => state.localVersion);
  const [meta, setMeta] = useState({ memos: 0, local: false });

  useEffect(() => {
    if (node.kind !== 'file' || !node.isPdf) return;
    void Promise.all([countActiveByFile(node.id), getFile(node.id)]).then(([memos, file]) => {
      setMeta({ memos, local: !!file?.currentBlobKey });
    });
  }, [node.id, node.kind, node.isPdf, localVersion]);

  if (node.kind === 'file' && !node.isPdf) return null;

  if (node.kind === 'folder') {
    return (
      <div className={depth === 0 ? 'tree-date' : undefined}>
        <button className="tree-item" type="button" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => useTree.getState().toggle(node.id)}>
          <span>{expanded ? '▾' : '▸'}</span>
          <span>{node.name}</span>
          {isNew && !seen && <Badge>새 자료</Badge>}
        </button>
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

  return (
    <button
      className={`tree-file ${selected ? 'on' : ''} ${node.isPdf ? '' : 'dim'}`}
      type="button"
      style={{ paddingLeft: 8 + depth * 12 }}
      title={node.isPdf ? node.name : 'PDF만 열람 가능'}
      onClick={() => {
        if (!node.isPdf) return;
        void openPdf(node);
      }}
    >
      <span>{node.isPdf ? 'PDF' : '파일'}</span>
      <span>{node.name}</span>
      {meta.local ? '✓' : '☁'}
      {meta.memos > 0 && <span>✎{meta.memos}</span>}
      {isNew && !seen && <Badge>새 자료</Badge>}
      {replaced && <Badge tone="warn">바뀜</Badge>}
    </button>
  );
}
