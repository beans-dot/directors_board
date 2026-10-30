import { todayKey } from './folderDate';

/** Solar dates of 설날, 부처님오신날, 추석. Korean lunar calendar, 2026–2040. */
const LUNAR: Record<number, { seollal: string; buddha: string; chuseok: string }> = {
  2026: { seollal: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
  2027: { seollal: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' },
  2028: { seollal: '2028-01-27', buddha: '2028-05-02', chuseok: '2028-10-03' },
  2029: { seollal: '2029-02-13', buddha: '2029-05-20', chuseok: '2029-09-22' },
  2030: { seollal: '2030-02-03', buddha: '2030-05-09', chuseok: '2030-09-12' },
  2031: { seollal: '2031-01-23', buddha: '2031-05-28', chuseok: '2031-10-01' },
  2032: { seollal: '2032-02-11', buddha: '2032-05-16', chuseok: '2032-09-19' },
  2033: { seollal: '2033-01-31', buddha: '2033-05-06', chuseok: '2033-09-08' },
  2034: { seollal: '2034-02-19', buddha: '2034-05-25', chuseok: '2034-09-27' },
  2035: { seollal: '2035-02-08', buddha: '2035-05-15', chuseok: '2035-09-16' },
  2036: { seollal: '2036-01-28', buddha: '2036-05-03', chuseok: '2036-10-04' },
  2037: { seollal: '2037-02-15', buddha: '2037-05-22', chuseok: '2037-09-24' },
  2038: { seollal: '2038-02-04', buddha: '2038-05-11', chuseok: '2038-09-13' },
  2039: { seollal: '2039-01-24', buddha: '2039-04-30', chuseok: '2039-10-02' },
  2040: { seollal: '2040-02-12', buddha: '2040-05-18', chuseok: '2040-09-21' },
};

const WEEKEND_SUBSTITUTE = new Set(['national', 'buddha', 'labor', 'children', 'christmas']);
const SUNDAY_SUBSTITUTE = new Set(['seollal', 'chuseok']);
const OVERLAP_SUBSTITUTE = new Set(['national', 'seollal', 'buddha', 'labor', 'children', 'chuseok', 'christmas']);

type HolidayKind =
  | 'national'
  | 'newyear'
  | 'seollal'
  | 'buddha'
  | 'labor'
  | 'children'
  | 'memorial'
  | 'chuseok'
  | 'christmas'
  | 'election';

const holidayCache = new Map<number, Set<string>>();

export function addDaysKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function weekdayKey(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return -1;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

function onOrAfterWeekday(dateKey: string, weekday: number): string {
  let cursor = dateKey;
  for (let step = 0; step < 7; step += 1) {
    if (weekdayKey(cursor) === weekday) return cursor;
    cursor = addDaysKey(cursor, 1);
  }
  return cursor;
}

/** 임기만료 선거일. 국회의원선거는 4년마다 5월 29일 50일 전 이후 첫 수요일, 지방선거는 4년마다 6월 첫 수요일. */
export function scheduledElectionKeys(year: number): string[] {
  const keys: string[] = [];
  if (year >= 2024 && (year - 2024) % 4 === 0) keys.push(onOrAfterWeekday(addDaysKey(`${year}-05-29`, -50), 3));
  if (year >= 2022 && (year - 2022) % 4 === 0) keys.push(onOrAfterWeekday(`${year}-06-01`, 3));
  return keys;
}

function basesFor(year: number): { key: string; kind: HolidayKind }[] {
  if (year < 2026 || year > 2040) return [];
  const lunar = LUNAR[year];
  const items: { key: string; kind: HolidayKind }[] = [
    { key: `${year}-01-01`, kind: 'newyear' },
    { key: `${year}-03-01`, kind: 'national' },
    { key: `${year}-05-01`, kind: 'labor' },
    { key: `${year}-05-05`, kind: 'children' },
    { key: `${year}-06-06`, kind: 'memorial' },
    { key: `${year}-07-17`, kind: 'national' },
    { key: `${year}-08-15`, kind: 'national' },
    { key: `${year}-10-03`, kind: 'national' },
    { key: `${year}-10-09`, kind: 'national' },
    { key: `${year}-12-25`, kind: 'christmas' },
  ];
  if (lunar) {
    items.push(
      { key: addDaysKey(lunar.seollal, -1), kind: 'seollal' },
      { key: lunar.seollal, kind: 'seollal' },
      { key: addDaysKey(lunar.seollal, 1), kind: 'seollal' },
      { key: lunar.buddha, kind: 'buddha' },
      { key: addDaysKey(lunar.chuseok, -1), kind: 'chuseok' },
      { key: lunar.chuseok, kind: 'chuseok' },
      { key: addDaysKey(lunar.chuseok, 1), kind: 'chuseok' },
    );
  }
  scheduledElectionKeys(year).forEach((key) => items.push({ key, kind: 'election' }));
  return items;
}

function nextOpenDay(dateKey: string, bases: Set<string>): string {
  let cursor = addDaysKey(dateKey, 1);
  for (let step = 0; step < 14; step += 1) {
    if (weekdayKey(cursor) !== 0 && !bases.has(cursor)) return cursor;
    cursor = addDaysKey(cursor, 1);
  }
  return cursor;
}

function buildHolidays(year: number): Set<string> {
  const grouped = new Map<string, HolidayKind[]>();
  for (const itemYear of [year - 1, year, year + 1]) {
    basesFor(itemYear).forEach((item) => {
      const kinds = grouped.get(item.key) ?? [];
      kinds.push(item.kind);
      grouped.set(item.key, kinds);
    });
  }
  const bases = new Set(grouped.keys());
  const targets: string[] = [];
  grouped.forEach((kinds, key) => {
    const unique = new Set(kinds);
    let count = 0;
    unique.forEach((kind) => {
      const weekday = weekdayKey(key);
      const weekend = WEEKEND_SUBSTITUTE.has(kind) && (weekday === 0 || weekday === 6);
      const sunday = SUNDAY_SUBSTITUTE.has(kind) && weekday === 0;
      const overlap = OVERLAP_SUBSTITUTE.has(kind) && weekday !== 0 && weekday !== 6 && unique.size > 1;
      if (weekend || sunday || overlap) count += 1;
    });
    if (!count) return;
    let target = nextOpenDay(key, bases);
    if (weekdayKey(target) === 6) target = nextOpenDay(target, bases);
    for (let index = 0; index < count; index += 1) targets.push(target);
  });
  const tally = new Map<string, number>();
  targets.forEach((target) => tally.set(target, (tally.get(target) ?? 0) + 1));
  const holidays = new Set(bases);
  tally.forEach((count, target) => {
    holidays.add(target);
    if (count < 2) return;
    let extra = nextOpenDay(target, bases);
    if (weekdayKey(extra) === 6) extra = nextOpenDay(extra, bases);
    holidays.add(extra);
  });
  return holidays;
}

function holidaysTouching(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const built = buildHolidays(year);
  holidayCache.set(year, built);
  return built;
}

/** 관공서 공휴일과 대체공휴일. 임시공휴일은 포함하지 않는다. 2026–2040. */
export function isKoreanHoliday(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  return holidaysTouching(Number(dateKey.slice(0, 4))).has(dateKey);
}

export function seoulHour(now = new Date()): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(value) % 24;
}

/** Monday 13:00 run that creates the following Monday 10:00 meeting. */
export function nextAutoRunKey(now = new Date()): string {
  const today = todayKey(now);
  const weekday = weekdayKey(today);
  let delta = (8 - weekday) % 7;
  if (weekday === 1 && seoulHour(now) >= 13) delta = 7;
  return addDaysKey(today, delta);
}

export function autoMeetingPlan(runMondayKey: string): { dateKey: string; time: '10:00' } | null {
  if (weekdayKey(runMondayKey) !== 1) return null;
  const next = addDaysKey(runMondayKey, 7);
  const year = Number(next.slice(0, 4));
  if (year < 2026 || year > 2040) return null;
  if (isKoreanHoliday(next)) return null;
  return { dateKey: next, time: '10:00' };
}
