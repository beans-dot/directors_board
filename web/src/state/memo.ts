import { create } from 'zustand';
import type { Annotation } from '../api/types';

interface MemoState {
  items: Annotation[];
  activeId: string | null;
  editorId: string | null;
  patch: (partial: Partial<MemoState>) => void;
}

export const useMemoStore = create<MemoState>((set) => ({
  items: [],
  activeId: null,
  editorId: null,
  patch: (partial) => set(partial),
}));
