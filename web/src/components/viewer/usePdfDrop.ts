import { useRef, useState, type DragEvent } from 'react';
import type { DriveNode } from '../../api/types';
import { currentPdfDrag, endPdfDrag, parsePdfDrag, pdfDragTypeList, PDF_DRAG_MIME } from '../../domain/pdfDrag';

function draggedPdf(data: DataTransfer | null): DriveNode | null {
  const parsed = data ? parsePdfDrag(data.getData(PDF_DRAG_MIME)) : null;
  return parsed ?? currentPdfDrag();
}

function accepts(data: DataTransfer | null): boolean {
  return Boolean(currentPdfDrag()) || pdfDragTypeList(data?.types);
}

export function usePdfDrop(onFile: (node: DriveNode) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const bind = {
    onDragEnter: (event: DragEvent) => {
      if (!accepts(event.dataTransfer)) return;
      event.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!accepts(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!accepts(event.dataTransfer)) return;
      event.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (event: DragEvent) => {
      const node = draggedPdf(event.dataTransfer);
      depth.current = 0;
      setOver(false);
      if (!node) return;
      event.preventDefault();
      endPdfDrag();
      onFile(node);
    },
  };
  return { over, bind };
}
