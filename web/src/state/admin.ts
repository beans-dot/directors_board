import { create } from 'zustand';
import type { AccessRow, AdminSettings, DeviceRow, SendLogRow } from '../api/types';

interface AdminState {
  tab: 'meeting' | 'materials' | 'access' | 'send' | 'officers' | 'tips';
  devices: DeviceRow[];
  access: AccessRow[];
  sends: SendLogRow[];
  settings: AdminSettings | null;
  loading: boolean;
  patch: (partial: Partial<AdminState>) => void;
}

export const useAdmin = create<AdminState>((set) => ({
  tab: 'materials',
  devices: [],
  access: [],
  sends: [],
  settings: null,
  loading: false,
  patch: (partial) => set(partial),
}));
