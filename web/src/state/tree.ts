import { create } from 'zustand';
import type { DateFolder } from '../api/types';

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
  localVersion: number;
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
  localVersion: 0,
  patch: (partial) => set(partial),
  toggle: (id) =>
    set((state) => ({
      expanded: { ...state.expanded, [id]: !state.expanded[id] },
      seenFolderIds: state.seenFolderIds.includes(id) ? state.seenFolderIds : [...state.seenFolderIds, id],
    })),
}));
