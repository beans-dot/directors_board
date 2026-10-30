export function Badge({ children, tone = 'accent' }: { children: string; tone?: 'accent' | 'warn' | 'muted' }) {
  return <span className={`badge ${tone === 'accent' ? '' : tone}`}>{children}</span>;
}
