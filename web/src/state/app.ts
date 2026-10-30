import { create } from 'zustand';
import type { Profile, PublicConfig } from '../api/types';

export interface ToastItem {
  id: number;
  text: string;
}

interface AppState {
  ready: boolean;
  online: boolean;
  profile: Profile | null;
  showOnboarding: boolean;
  showAdminConvert: boolean;
  showBackup: boolean;
  showSend: boolean;
  screen: 'main' | 'admin';
  config: PublicConfig | null;
  toasts: ToastItem[];
  drawerOpen: boolean;
  memoOpen: boolean;
  menuOpen: boolean;
  lastFetchedAt: string;
  statusText: string;
  replaceNotice: string | null;
  patch: (partial: Partial<AppState>) => void;
  toast: (text: string) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 1;

export const useApp = create<AppState>((set) => ({
  ready: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  profile: null,
  showOnboarding: false,
  showAdminConvert: false,
  showBackup: false,
  showSend: false,
  screen: 'main',
  config: null,
  toasts: [],
  drawerOpen: false,
  memoOpen: true,
  menuOpen: false,
  lastFetchedAt: '',
  statusText: '',
  replaceNotice: null,
  patch: (partial) => set(partial),
  toast: (text) => set((state) => ({ toasts: [...state.toasts, { id: toastSeq++, text }] })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));
