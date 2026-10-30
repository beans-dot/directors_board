export function MemoPin({ x, y, n, active }: { x: number; y: number; n: number; active: boolean }) {
  const fill = active ? '#2f6fed' : '#fff';
  const ink = active ? '#fff' : '#2f6fed';
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M-1 -20 H11 L15 -16 V2 H-1 Z" fill={fill} stroke="#2f6fed" strokeWidth="1.4" />
      <path d="M11 -20 V-16 H15" fill="none" stroke="#2f6fed" strokeWidth="1.4" />
      <text x="7" y="-5" textAnchor="middle" fontSize="10" fontWeight="700" fill={ink}>
        {n}
      </text>
      <title>{`메모 ${n}`}</title>
    </g>
  );
}
