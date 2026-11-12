import { create } from 'zustand';
import type { ChangeNotice, DateFolder } from '../api/types';

interface TreeState {
  folders: DateFolder[];
  loading: boolean;
  expanded: Record<string, boolean>;
  selectedId: string | null;
  newFolderIds: string[];
  newFileIds: string[];
  replacedIds: string[];
  seenFolderIds: string[];
  seenFileIds: string[];
  localFiles: Record<string, true>;
  localVersion: number;
  changeNotices: ChangeNotice[];
  patch: (partial: Partial<TreeState>) => void;
  toggle: (id: string) => void;
}

export const useTree = create<TreeState>((set) => ({
  folders: [],
  loading: false,
  expanded: {},
  selectedId: null,
  newFolderIds: [],
  newFileIds: [],
  replacedIds: [],
  seenFolderIds: [],
  seenFileIds: [],
  localFiles: {},
  localVersion: 0,
  changeNotices: [],
  patch: (partial) => set(partial),
  toggle: (id) =>
    set((state) => ({
      expanded: { ...state.expanded, [id]: !state.expanded[id] },
      seenFolderIds: state.seenFolderIds.includes(id) ? state.seenFolderIds : [...state.seenFolderIds, id],
    })),
}));
