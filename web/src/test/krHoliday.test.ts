import { describe, expect, it } from 'vitest';
import { addDaysKey, autoMeetingPlan, isKoreanHoliday, scheduledElectionKeys, weekdayKey } from '../domain/krHoliday';

function mondays(year: number): string[] {
  let cursor = `${year}-01-01`;
  while (weekdayKey(cursor) !== 1) cursor = addDaysKey(cursor, 1);
  const days: string[] = [];
  while (cursor.startsWith(String(year))) {
    days.push(cursor);
    cursor = addDaysKey(cursor, 7);
  }
  return days;
}

describe('korean holidays', () => {
  it('matches the published Monday holidays for 2026 and 2027', () => {
    expect(mondays(2026).filter(isKoreanHoliday)).toEqual([
      '2026-02-16',
      '2026-03-02',
      '2026-05-25',
      '2026-08-17',
      '2026-10-05',
    ]);
    expect(mondays(2027).filter(isKoreanHoliday)).toEqual([
      '2027-02-08',
      '2027-03-01',
      '2027-05-03',
      '2027-07-19',
      '2027-08-16',
      '2027-10-04',
      '2027-10-11',
      '2027-12-27',
    ]);
  });

  it('does not invent substitutes for 현충일, 신정, or a Saturday 추석', () => {
    expect(isKoreanHoliday('2026-06-08')).toBe(false);
    expect(isKoreanHoliday('2026-09-28')).toBe(false);
    expect(isKoreanHoliday('2027-06-07')).toBe(false);
    expect(isKoreanHoliday('2026-06-03')).toBe(true);
    expect(isKoreanHoliday('2028-04-12')).toBe(true);
    expect(scheduledElectionKeys(2022)).toEqual(['2022-06-01']);
    expect(scheduledElectionKeys(2024)).toEqual(['2024-04-10']);
  });

  it('plans next Monday at 10:00 and skips a holiday Monday', () => {
    expect(autoMeetingPlan('2026-10-26')).toEqual({ dateKey: '2026-11-02', time: '10:00' });
    expect(autoMeetingPlan('2026-11-02')).toEqual({ dateKey: '2026-11-09', time: '10:00' });
    expect(autoMeetingPlan('2026-02-09')).toBeNull();
    expect(autoMeetingPlan('2026-08-10')).toBeNull();
    expect(autoMeetingPlan('2028-10-02')).toBeNull();
    expect(autoMeetingPlan('2026-10-30')).toBeNull();
  });
});
