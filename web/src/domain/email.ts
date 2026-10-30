export const ALLOWED_RECIPIENT_DOMAIN = 'yeonsung.ac.kr';

export function isAllowedRecipient(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.includes(',') || value.includes(';') || /\s/.test(value)) return false;
  return /^[^\s@]+@yeonsung\.ac\.kr$/i.test(value);
}
