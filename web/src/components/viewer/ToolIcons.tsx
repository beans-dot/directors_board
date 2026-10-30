import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {children}
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconPrev() {
  return (
    <Svg>
      <path d="M14 6 L8 12 L14 18" {...stroke} />
    </Svg>
  );
}

export function IconNext() {
  return (
    <Svg>
      <path d="M10 6 L16 12 L10 18" {...stroke} />
    </Svg>
  );
}

export function IconZoomOut() {
  return (
    <Svg>
      <circle cx="10" cy="10" r="5.5" {...stroke} />
      <path d="M14.2 14.2 L19 19 M7.5 10 H12.5" {...stroke} />
    </Svg>
  );
}

export function IconZoomIn() {
  return (
    <Svg>
      <circle cx="10" cy="10" r="5.5" {...stroke} />
      <path d="M14.2 14.2 L19 19 M10 7.5 V12.5 M7.5 10 H12.5" {...stroke} />
    </Svg>
  );
}

export function IconFitWidth() {
  return (
    <Svg>
      <rect x="6" y="4" width="12" height="16" {...stroke} />
      <path d="M9 12 H4 M4 12 l2-2 M4 12 l2 2 M15 12 h5 M20 12 l-2-2 M20 12 l-2 2" {...stroke} />
    </Svg>
  );
}

export function IconFitPage() {
  return (
    <Svg>
      <rect x="7" y="3" width="10" height="14" {...stroke} />
      <path d="M12 17 v4 M12 21 l-2-2 M12 21 l2-2" {...stroke} />
    </Svg>
  );
}

export function IconThumbs() {
  return (
    <Svg>
      <rect x="4" y="4" width="7" height="9" {...stroke} />
      <rect x="13" y="4" width="7" height="9" {...stroke} />
      <rect x="4" y="15" width="7" height="5" {...stroke} />
      <rect x="13" y="15" width="7" height="5" {...stroke} />
    </Svg>
  );
}

export function IconFind() {
  return (
    <Svg>
      <circle cx="10" cy="10" r="5.5" {...stroke} />
      <path d="M14.2 14.2 L19 19" {...stroke} />
    </Svg>
  );
}

export function IconSelect() {
  return (
    <Svg>
      <path d="M6 4 L6 18 L10 14 L13 20 L15.2 19 L12.2 13 H18 Z" {...stroke} />
    </Svg>
  );
}

export function IconNote() {
  return (
    <Svg>
      <path d="M6 4 H14 L18 8 V20 H6 Z" {...stroke} />
      <path d="M14 4 V8 H18" {...stroke} />
    </Svg>
  );
}

export function IconHighlight() {
  return (
    <Svg>
      <path d="M11.2 9 L15.6 4.6 L18.8 7.8 L14.4 12.2 Z" fill="#f5c518" stroke="none" />
      <path d="M4 16.2 L11.2 9 L14.4 12.2 L7.2 19.4 H4 Z" {...stroke} />
      <path d="M11.2 9 L15.6 4.6 L18.8 7.8 L14.4 12.2" {...stroke} />
    </Svg>
  );
}

export function IconUnderline() {
  return (
    <Svg>
      <path d="M7 5 V12 a5 5 0 0 0 10 0 V5" {...stroke} />
      <path d="M5 20 H19" {...stroke} />
    </Svg>
  );
}

export function IconPen() {
  return (
    <Svg>
      <path d="M14 5 L19 10 L9 20 H4 V15 Z" {...stroke} />
      <path d="M12 7 L17 12" {...stroke} />
    </Svg>
  );
}

export function IconEraser() {
  return (
    <Svg>
      <path d="M5 15 L12 6 L20 14 L14 20 H8 Z" {...stroke} />
      <path d="M8 20 H20 M9 13 L16 16" {...stroke} />
    </Svg>
  );
}

export function ToolButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`tool-btn${on ? ' on' : ''}`} title={label} aria-label={label} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}
