import { useEffect, useState } from 'react';
import { useViewer } from '../../state/viewer';

export function ThumbnailRail() {
  const doc = useViewer((state) => state.doc);
  const page = useViewer((state) => state.page);
  const open = useViewer((state) => state.thumbOpen);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    if (!doc || !open) return;
    let cancel = false;
    void (async () => {
      const next: string[] = [];
      for (let number = 1; number <= doc.numPages; number += 1) {
        const pdfPage = await doc.getPage(number);
        const viewport = pdfPage.getViewport({ scale: 0.12 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) continue;
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        next.push(canvas.toDataURL());
      }
      if (!cancel) setUrls(next);
    })();
    return () => {
      cancel = true;
    };
  }, [doc, open]);
  if (!open) return null;
  return (
    <div className="thumb-rail">
      {urls.map((url, index) => (
        <button key={`${index}-${url.slice(0, 16)}`} type="button" className={page === index + 1 ? 'on' : ''} title={`${index + 1}쪽`} aria-label={`${index + 1}쪽`} onClick={() => useViewer.getState().patch({ page: index + 1 })}>
          <img src={url} alt="" />
          <span>{index + 1}</span>
        </button>
      ))}
    </div>
  );
}
