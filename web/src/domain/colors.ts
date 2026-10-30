/** 빨주노초파남보, 그리고 검정·하양. 화면과 PDF에 같은 색을 쓴다. */
export const MARK_COLORS = [
  { id: 'red', label: '빨강', hex: '#e03131' },
  { id: 'orange', label: '주황', hex: '#f76707' },
  { id: 'yellow', label: '노랑', hex: '#f5c518' },
  { id: 'green', label: '초록', hex: '#2f9e44' },
  { id: 'blue', label: '파랑', hex: '#2f6fed' },
  { id: 'indigo', label: '남색', hex: '#364fc7' },
  { id: 'violet', label: '보라', hex: '#9c36b5' },
  { id: 'black', label: '검정', hex: '#111111' },
  { id: 'white', label: '하양', hex: '#ffffff' },
] as const;

export type MarkColorId = (typeof MARK_COLORS)[number]['id'];

export function markHex(color?: string): string {
  return MARK_COLORS.find((item) => item.id === color)?.hex ?? '#f5c518';
}
