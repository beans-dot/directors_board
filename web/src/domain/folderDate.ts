const FOLDER_RE = /^(\d{2})\.(\d{1,2})\.(\d{1,2})\.?$/;

export interface ParsedFolderDate {
  folderDate: string;
  dateKey: string;
}

export function parseFolderDate(name: string): ParsedFolderDate | null {
  const match = name.trim().match(FOLDER_RE);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return { folderDate: `${yy}.${mm}.${dd}.`, dateKey: `${year}-${mm}-${dd}` };
}

export function todayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function todayFolderDate(now = new Date()): string {
  const [year, month, day] = todayKey(now).split('-');
  return `${year.slice(-2)}.${month}.${day}.`;
}

export function formatKoreanDate(now = new Date()): string {
  const key = todayKey(now);
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
  }).format(now);
  const [year, month, day] = key.split('-');
  return `${year}.${month}.${day}.(${weekday})`;
}

export function folderDateToKey(folderDate: string): string {
  return parseFolderDate(folderDate)?.dateKey ?? folderDate;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function dateKeyToFolderDate(dateKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2099 || month < 1 || month > 12) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(year).slice(-2)}.${match[2]}.${match[3]}.`;
}

export function formatMeetingLabel(dateKey: string, time = ''): string {
  if (!dateKeyToFolderDate(dateKey)) return '';
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = WEEKDAY_KO[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? ` ${time}` : '';
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `회의 ${year}.${mm}.${dd}.(${weekday})${clock}`;
}
