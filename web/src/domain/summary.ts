import type { Annotation } from '../api/types';

export interface SummaryFile {
  topFolder: string;
  name: string;
  annotations: Annotation[];
}

const TYPE_LABEL: Record<Annotation['type'], string> = {
  pin: '메모',
  highlight: '형광펜',
  underline: '밑줄',
  ink: '손글씨',
};

export function sourceFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export function sourceFolderNote(folderId: string): { html: string; text: string } {
  const url = sourceFolderUrl(folderId);
  const label = '원본 자료';
  return {
    html: `<p>${escapeHtml(label)}<br><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    text: `${label}\n${url}`,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lineFor(ann: Annotation): string {
  const label = TYPE_LABEL[ann.type];
  const text = ann.content.trim();
  if (ann.type === 'pin') return text || '(내용 없음)';
  return text ? `[${label}] ${text}` : `[${label}] ${ann.page}쪽`;
}

export function buildSummary(files: SummaryFile[]): { html: string; text: string } {
  const activeFiles = files.map((file) => ({
    ...file,
    annotations: file.annotations
      .filter((ann) => ann.status === 'active')
      .slice()
      .sort((a, b) => a.page - b.page || a.y - b.y),
  }));

  const textParts: string[] = ['보직회의 메모 요약', ''];
  const htmlParts: string[] = ['<div style="font-family:sans-serif;font-size:14px">', '<h2>보직회의 메모 요약</h2>'];

  const folders = new Map<string, SummaryFile[]>();
  for (const file of activeFiles) {
    const list = folders.get(file.topFolder) ?? [];
    list.push(file);
    folders.set(file.topFolder, list);
  }

  for (const [folder, list] of folders) {
    textParts.push(`[${folder}]`);
    htmlParts.push(`<h3>${escapeHtml(folder)}</h3>`);
    for (const file of list) {
      textParts.push(`- ${file.name}`);
      htmlParts.push(`<p><b>${escapeHtml(file.name)}</b></p>`);
      if (!file.annotations.length) {
        textParts.push('  (메모 없음)');
        htmlParts.push('<p style="color:#667085">(메모 없음)</p>');
        continue;
      }
      htmlParts.push('<ul>');
      const byPage = new Map<number, Annotation[]>();
      for (const ann of file.annotations) {
        const page = byPage.get(ann.page) ?? [];
        page.push(ann);
        byPage.set(ann.page, page);
      }
      for (const [page, anns] of byPage) {
        textParts.push(`  ${page}쪽`);
        htmlParts.push(`<li>${page}쪽<ul>`);
        for (const ann of anns) {
          const line = lineFor(ann);
          textParts.push(`    - ${line}`);
          htmlParts.push(`<li>${escapeHtml(line)}</li>`);
        }
        htmlParts.push('</ul></li>');
      }
      htmlParts.push('</ul>');
    }
    textParts.push('');
  }

  htmlParts.push('</div>');
  return { html: htmlParts.join(''), text: textParts.join('\n').trim() };
}
