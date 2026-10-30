import { PdfViewer } from '../viewer/PdfViewer';
import { MemoListPanel } from '../memo/MemoListPanel';

export function MainArea() {
  return (
    <section className="main-area">
      <div className="viewer-wrap">
        <PdfViewer />
        <MemoListPanel />
      </div>
    </section>
  );
}
