import type { Annotation } from '../api/types';

export function pinsInNumberOrder(pins: Annotation[]): Annotation[] {
  return pins
    .filter((ann) => ann.type === 'pin')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function pinNumberMap(pins: Annotation[]): Map<string, number> {
  return new Map(pinsInNumberOrder(pins).map((ann, index) => [ann.id, index + 1]));
}
