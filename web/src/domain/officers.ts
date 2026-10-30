import type { Officer } from '../api/types';
import { isAllowedRecipient } from './email';

export type { Officer };

export function officerCanLogin(officer: Pick<Officer, 'position' | 'name' | 'email'>): boolean {
  return officer.position.trim().length > 0 && officer.name.trim().length > 0 && isAllowedRecipient(officer.email);
}

export function prepareOfficerList(rows: Officer[]): { officers: Officer[] } | { error: string } {
  if (rows.length > 30) return { error: '보직자는 30명까지 등록할 수 있습니다.' };
  const emails = new Set<string>();
  const officers: Officer[] = [];
  for (const row of rows) {
    const position = row.position.trim();
    const name = row.name.trim();
    const email = row.email.trim().toLowerCase();
    if (!position) return { error: '직위가 비어 있는 항목이 있습니다.' };
    if (position.length > 40) return { error: '직위는 40자 이내로 입력해 주세요.' };
    if (name.length > 40) return { error: '이름은 40자 이내로 입력해 주세요.' };
    if (email && !isAllowedRecipient(email)) return { error: '연성대학교 메일(@yeonsung.ac.kr)만 등록할 수 있습니다.' };
    if (email && emails.has(email)) return { error: '같은 메일 주소가 두 번 있습니다.' };
    if (email) emails.add(email);
    officers.push({ id: row.id, position, name, email });
  }
  return { officers };
}
