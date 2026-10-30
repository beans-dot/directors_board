import { useEffect } from 'react';
import { useApp } from '../../state/app';

export function Toast() {
  const toasts = useApp((state) => state.toasts);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => useApp.getState().dismiss(toasts[0].id), 3000);
    return () => window.clearTimeout(timer);
  }, [toasts]);
  return (
    <div className="toast-wrap">
      {toasts.map((item) => (
        <div className="toast" key={item.id}>
          {item.text}
        </div>
      ))}
    </div>
  );
}
