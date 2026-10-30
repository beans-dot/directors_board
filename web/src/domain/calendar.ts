export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export interface CalendarDay {
  dateKey: string;
  day: number;
  inMonth: boolean;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthGrid(year: number, month: number): CalendarDay[][] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prev = shiftMonth(year, month, -1);
  const prevDays = new Date(Date.UTC(prev.year, prev.month, 0)).getUTCDate();
  const cells: CalendarDay[] = [];
  for (let index = 0; index < firstWeekday; index += 1) {
    const day = prevDays - firstWeekday + 1 + index;
    cells.push({ dateKey: dateKey(prev.year, prev.month, day), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ dateKey: dateKey(year, month, day), day, inMonth: true });
  }
  const next = shiftMonth(year, month, 1);
  let extra = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ dateKey: dateKey(next.year, next.month, extra), day: extra, inMonth: false });
    extra += 1;
  }
  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}
