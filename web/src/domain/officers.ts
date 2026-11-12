import type { Officer } from '../api/types';
import { isAllowedRecipient } from './email';

export type { Officer };

const EMPLOYEE_RE = /^[A-Za-z0-9]{4,20}$/;

export function officerCanLogin(officer: Pick<Officer, 'position' | 'name' | 'employeeNo' | 'ready'>): boolean {
  if (officer.ready === false) return false;
  if (!officer.position.trim() || !officer.name.trim()) return false;
  if (officer.employeeNo == null) return true;
  return EMPLOYEE_RE.test(officer.employeeNo);
}

export function moveOfficer<T extends { id: string }>(rows: T[], fromId: string, toId: string): T[] {
  const from = rows.findIndex((row) => row.id === fromId);
  const to = rows.findIndex((row) => row.id === toId);
  if (from < 0 || to < 0 || from === to) return rows;
  const next = rows.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function prepareOfficerList(rows: Officer[]): { officers: Officer[] } | { error: string } {
  if (rows.length > 30) return { error: '보직자는 30명까지 등록할 수 있습니다.' };
  const emails = new Set<string>();
  const numbers = new Set<string>();
  const officers: Officer[] = [];
  for (const row of rows) {
    const position = row.position.trim();
    const name = row.name.trim();
    const email = row.email.trim().toLowerCase();
    const employeeNo = (row.employeeNo || '').trim();
    if (!position) return { error: '직위가 비어 있는 항목이 있습니다.' };
    if (position.length > 40) return { error: '직위는 40자 이내로 입력해 주세요.' };
    if (name.length > 40) return { error: '이름은 40자 이내로 입력해 주세요.' };
    if (name && !EMPLOYEE_RE.test(employeeNo)) return { error: '사번은 4자 이상 20자 이하의 영문과 숫자입니다.' };
    if (employeeNo && !EMPLOYEE_RE.test(employeeNo)) return { error: '사번은 4자 이상 20자 이하의 영문과 숫자입니다.' };
    if (email && !isAllowedRecipient(email)) return { error: '연성대학교 메일(@yeonsung.ac.kr)만 등록할 수 있습니다.' };
    if (email && emails.has(email)) return { error: '같은 메일 주소가 두 번 있습니다.' };
    if (employeeNo && numbers.has(employeeNo)) return { error: '같은 사번이 두 번 있습니다.' };
    if (email) emails.add(email);
    if (employeeNo) numbers.add(employeeNo);
    officers.push({ id: row.id, position, name, email, employeeNo });
  }
  return { officers };
}
