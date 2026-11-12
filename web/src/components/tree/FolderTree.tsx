import { useTree } from '../../state/tree';
import { EmptyState } from '../common/EmptyState';
import { TreeNode } from './TreeNode';

export function FolderTree() {
  const folders = useTree((state) => state.folders);
  if (!folders.length) return <EmptyState>자료 폴더가 없습니다. 관리자가 회의를 만들면 여기에 나타납니다.</EmptyState>;
  return (
    <div className="tree" role="tree">
      {folders.map((folder) => (
        <TreeNode key={folder.id} node={folder} depth={0} />
      ))}
    </div>
  );
}
