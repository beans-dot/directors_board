export function MemoPin({ x, y, n, active }: { x: number; y: number; n: number; active: boolean }) {
  const fill = active ? '#2f6fed' : '#fff';
  const ink = active ? '#fff' : '#2f6fed';
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle cx="0" cy="-12" r="11" fill={fill} stroke="#2f6fed" strokeWidth="1.6" />
      <text x="0" y="-8" textAnchor="middle" fontSize="11" fontWeight="700" fill={ink}>
        {n}
      </text>
      <title>{`메모 ${n}`}</title>
    </g>
  );
}
