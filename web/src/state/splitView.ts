import { create } from 'zustand';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DriveNode } from '../api/types';

export type SplitFit = 'width' | 'height' | 'custom';

interface SplitState {
  open: boolean;
  ratio: number;
  file: DriveNode | null;
  doc: PDFDocumentProxy | null;
  page: number;
  pageCount: number;
  zoom: number;
  fit: SplitFit;
  thumbOpen: boolean;
  loading: boolean;
  patch: (partial: Partial<Omit<SplitState, 'patch'>>) => void;
}

export const useSplit = create<SplitState>((set) => ({
  open: false,
  ratio: 0.5,
  file: null,
  doc: null,
  page: 1,
  pageCount: 0,
  zoom: 1,
  fit: 'width',
  thumbOpen: false,
  loading: false,
  patch: (partial) => set(partial),
}));

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.8, Math.max(0.2, ratio));
}

export function splitRatioFromDrag(start: number, deltaX: number, width: number): number {
  if (width <= 0) return clampSplitRatio(start);
  return clampSplitRatio(start + deltaX / width);
}
