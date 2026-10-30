import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts', 'NanumGothic-Regular.ttf');
const url = 'https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf';

const res = await fetch(url);
if (!res.ok) {
  console.error('한글 폰트를 받지 못했습니다:', res.status);
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
if (bytes.length < 10000) {
  console.error('받은 파일이 너무 작습니다.');
  process.exit(1);
}
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, bytes);
console.log('저장:', dest, bytes.length, 'bytes');
