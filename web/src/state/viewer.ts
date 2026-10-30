import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DriveNode, LocalFile } from '../api/types';
import type { MarkColorId } from '../domain/colors';
import type { FindHit } from '../domain/pdfFind';

export type MemoTool = 'select' | 'pin' | 'highlight' | 'underline' | 'ink' | 'erase';

interface ViewerState {
  file: DriveNode | null;
  local: LocalFile | null;
  doc: PDFDocumentProxy | null;
  page: number;
  pageCount: number;
  zoom: number;
  fit: 'width' | 'page' | 'custom';
  tool: MemoTool;
  color: MarkColorId;
  thumbOpen: boolean;
  findOpen: boolean;
  findQuery: string;
  findHitQuery: string;
  findHits: FindHit[];
  findIndex: number;
  findTick: number;
  loading: boolean;
  readOnly: boolean;
  patch: (partial: Partial<ViewerState>) => void;
}

export const useViewer = create<ViewerState>((set) => ({
  file: null,
  local: null,
  doc: null,
  page: 1,
  pageCount: 0,
  zoom: 1,
  fit: 'width',
  tool: 'select',
  color: 'yellow',
  thumbOpen: false,
  findOpen: false,
  findQuery: '',
  findHitQuery: '',
  findHits: [],
  findIndex: -1,
  findTick: 0,
  loading: false,
  readOnly: false,
  patch: (partial) => set(partial),
}));
