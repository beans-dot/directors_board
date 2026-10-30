import type { Annotation, DriveNode } from '../../api/types';
import { openPdf } from '../../services/runtime';
import { useTree } from '../../state/tree';
import { useViewer } from '../../state/viewer';

export function MemoSearchResults({
  hits,
  keyword,
  onPick,
}: {
  hits: Annotation[];
  keyword: string;
  onPick: () => void;
}) {
  if (!hits.length) return null;
  return (
    <div className="search-results">
      {hits.slice(0, 50).map((ann) => (
        <button
          key={ann.id}
          type="button"
          onClick={() => {
            const folder = useTree.getState().folders.find((item) => item.folderDate === ann.folderDate);
            const file = folder && findFile(folder, ann.driveFileId);
            if (file) void openPdf(file);
            useViewer.getState().patch({ page: ann.page });
            onPick();
          }}
        >
          <b>{ann.folderDate}</b> {ann.topFolder} / {ann.path}
          <div>{highlight(ann.content, keyword)}</div>
          <span className="help">{ann.page}쪽</span>
        </button>
      ))}
    </div>
  );
}

function findFile(node: DriveNode, id: string): DriveNode | null {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findFile(child, id);
    if (found) return found;
  }
  return null;
}

function highlight(text: string, keyword: string) {
  const index = text.toLowerCase().indexOf(keyword.trim().toLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + keyword.trim().length)}</mark>
      {text.slice(index + keyword.trim().length)}
    </>
  );
}
