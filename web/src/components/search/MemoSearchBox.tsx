import { useEffect, useState } from 'react';
import type { Annotation } from '../../api/types';
import { listActiveAnnotations } from '../../db/annotations';
import { searchAnnotations } from '../../domain/search';
import { MemoSearchResults } from './MemoSearchResults';

export function MemoSearchBox() {
  const [keyword, setKeyword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [folder, setFolder] = useState('');
  const [hits, setHits] = useState<Annotation[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void listActiveAnnotations().then((rows) => {
        setFolders([...new Set(rows.map((row) => row.topFolder))]);
        setHits(keyword.trim() ? searchAnnotations(rows, { keyword, from, to, topFolder: folder || undefined }) : []);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [keyword, from, to, folder]);
  return (
    <div className="memo-search">
      <input aria-label="메모 검색" placeholder="메모 검색" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      {hits.length > 0 && (
        <div className="search-results" style={{ padding: 8 }}>
          <input type="date" aria-label="시작일" value={from} onChange={(event) => setFrom(event.target.value)} />
          <input type="date" aria-label="종료일" value={to} onChange={(event) => setTo(event.target.value)} />
          <div>
            {folders.map((name) => (
              <button key={name} className={`btn btn-sm ${folder === name ? 'btn-primary' : 'btn-line'}`} type="button" onClick={() => setFolder(folder === name ? '' : name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      <MemoSearchResults hits={hits} keyword={keyword} onPick={() => setHits([])} />
    </div>
  );
}
