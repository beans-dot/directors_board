export async function loadKoreanFont(): Promise<Uint8Array> {
  const cached = await caches.open('bojik-font').catch(() => null);
  const url = '/fonts/NanumGothic-Regular.ttf';
  if (cached) {
    const hit = await cached.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('한글 폰트 파일이 없습니다');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (cached) await cached.put(url, new Response(bytes));
  return bytes;
}
