import type { Annotation } from '../api/types';
import { parseFolderDate } from './folderDate';

export interface SearchQuery {
  keyword: string;
  from?: string;
  to?: string;
  topFolder?: string;
}

export function searchAnnotations(annotations: Annotation[], query: SearchQuery): Annotation[] {
  const needle = query.keyword.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle) return [];
  return annotations.filter((ann) => {
    if (ann.status !== 'active') return false;
    const hay = ann.content.toLowerCase().replace(/\s+/g, '');
    if (!hay.includes(needle)) return false;
    if (query.topFolder && ann.topFolder !== query.topFolder) return false;
    const key = (parseFolderDate(ann.folderDate)?.dateKey ?? '').replace(/-/g, '');
    if (query.from && key < query.from.replace(/-/g, '')) return false;
    if (query.to && key > query.to.replace(/-/g, '')) return false;
    return true;
  });
}
