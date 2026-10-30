import type { Annotation, ISODate } from '../api/types';

export interface MigrateInput {
  annotations: Annotation[];
  nextFileId: string;
  nextPageCount?: number;
  previous: { modifiedTime: ISODate; md5?: string; driveFileId: string };
  at: ISODate;
}

export interface MigrateResult {
  annotations: Annotation[];
  movedCount: number;
}

export function migrateAnnotations(input: MigrateInput): MigrateResult {
  const active = input.annotations.filter((ann) => ann.status === 'active' && ann.driveFileId === input.previous.driveFileId);
  const others = input.annotations.filter((ann) => !active.includes(ann));
  const moved = active.map((ann) => {
    let page = ann.page;
    let content = ann.content;
    if (input.nextPageCount && page > input.nextPageCount) {
      content = `원래 ${page}쪽\n${content}`.trim();
      page = input.nextPageCount;
    }
    return {
      ...ann,
      driveFileId: input.nextFileId,
      page,
      content,
      version: ann.version + 1,
      updatedAt: input.at,
      movedFromVersion: {
        modifiedTime: input.previous.modifiedTime,
        md5: input.previous.md5,
        driveFileId: input.previous.driveFileId,
      },
    };
  });
  return { annotations: [...others, ...moved], movedCount: moved.length };
}
