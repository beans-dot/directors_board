export const USAGE_TIP_LINE_PX = 22;
export const USAGE_TIP_SLIDE_MS = 450;
export const USAGE_TIP_INTERVAL_MS = 6000;
export const USAGE_TIP_MAX_CHARS = 100;
export const USAGE_TIP_MAX_COUNT = 20;

export function usageTipCharLimit(barWidth: number, charWidth: number): number | null {
  if (barWidth < 8 || charWidth <= 0) return null;
  return Math.max(1, Math.min(USAGE_TIP_MAX_CHARS, Math.floor(barWidth / charWidth)));
}

export function clampUsageTip(text: string, limit: number): string {
  const flat = text.replace(/[\r\n]+/g, '');
  const cap = Math.max(0, limit);
  return [...flat].slice(0, cap).join('');
}

export function usageTipRows(tips: string[], limit: number): string[] {
  const next = (tips.length ? tips : ['']).map((tip) => clampUsageTip(tip, limit));
  return next.length ? next : [''];
}
