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

/** 전체 회의자료를 한 번에 받을 때 저장되는 압축 파일 이름입니다. */
export function meetingZipName(dateKey: string, folderDate = ''): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : folderDateToKey(folderDate);
  const dotted = /^\d{4}-\d{2}-\d{2}$/.test(key) ? key.replace(/-/g, '.') : folderDate.replace(/\.$/, '') || '자료';
  return `${dotted} 보직회의자료.zip`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 2026-11-12, 2026.11.12, 26.11.12. 같은 입력을 날짜 키로 맞춘다. */
export function parseDateInput(raw: string): string | null {
  const text = raw.trim();
  const full = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(text);
  const short = /^(\d{2})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(text);
  const match = full || short;
  if (!match) return null;
  const year = full ? Number(match[1]) : 2000 + Number(match[1]);
  const month = String(Number(match[2])).padStart(2, '0');
  const day = String(Number(match[3])).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;
  return dateKeyToFolderDate(dateKey) ? dateKey : null;
}

export function dateKeyToFolderDate(dateKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2099 || month < 1 || month > 12) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    return null;
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
