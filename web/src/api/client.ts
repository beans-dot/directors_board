import { GAS_URL } from '../config';
import type { FilePayload, GasFail, GasOk } from './types';

export class GasError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GasError';
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor(message = '서버와 연결하지 못했습니다. 잠시 후 새로고침해 주세요.') {
    super(message);
    this.name = 'NetworkError';
  }
}

const RETRY_ACTIONS = new Set(['tree', 'config', 'file', 'boot']);

export function timeoutFor(action: string): number {
  if (action === 'file') return 300_000;
  if (action === 'tree' || action === 'boot') return 240_000;
  if (action === 'send' || action === 'stage' || action === 'materialZip') return 330_000;
  return 30_000;
}

export interface GasCallContext {
  url?: string;
  deviceId: string;
  adminToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function gasCall<T>(action: string, payload: unknown, ctx: GasCallContext): Promise<T> {
  const queued = action === 'tree' || action === 'file';
  const attempts = queued ? 4 : RETRY_ACTIONS.has(action) ? 2 : 1;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await once<T>(action, payload, ctx);
    } catch (error) {
      const busy = error instanceof GasError && error.code === 'BUSY';
      if (error instanceof GasError && !busy) throw error;
      last = error;
      if (attempt < attempts - 1) await sleep(busy ? 2000 : 300 * 2 ** attempt);
    }
  }
  if (last instanceof GasError) throw last;
  if (last instanceof NetworkError) throw last;
  throw new NetworkError();
}

export function parsePdfBody(text: string): FilePayload {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('BOJIKPDF1\n')) {
    let json: GasOk<unknown> | GasFail;
    try {
      json = JSON.parse(trimmed) as GasOk<unknown> | GasFail;
    } catch {
      throw new NetworkError('파일 응답이 올바르지 않습니다.');
    }
    if (!json.ok) throw new GasError(json.error.code, json.error.message);
    throw new NetworkError('파일 응답이 올바르지 않습니다.');
  }
  const headerAt = trimmed.indexOf('\n', 'BOJIKPDF1\n'.length);
  if (headerAt < 0) throw new NetworkError('파일 응답이 올바르지 않습니다.');
  let meta: Partial<FilePayload>;
  try {
    meta = JSON.parse(trimmed.slice('BOJIKPDF1\n'.length, headerAt)) as Partial<FilePayload>;
  } catch {
    throw new NetworkError('파일 응답이 올바르지 않습니다.');
  }
  const base64 = trimmed.slice(headerAt + 1).replace(/\s+/g, '');
  if (!meta.fileId || !base64) throw new NetworkError('파일 응답이 올바르지 않습니다.');
  return {
    fileId: meta.fileId,
    name: meta.name || '',
    mimeType: 'application/pdf',
    modifiedTime: meta.modifiedTime,
    md5Checksum: meta.md5Checksum,
    size: meta.size,
    base64,
  };
}

export async function gasFile(fileId: string, ctx: GasCallContext): Promise<FilePayload> {
  const attempts = 4;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fileOnce(fileId, ctx);
    } catch (error) {
      const busy = error instanceof GasError && error.code === 'BUSY';
      if (error instanceof GasError && !busy) throw error;
      last = error;
      if (attempt < attempts - 1) await sleep(busy ? 2000 : 300 * 2 ** attempt);
    }
  }
  if (last instanceof GasError) throw last;
  if (last instanceof NetworkError) throw last;
  throw new NetworkError();
}

async function fileOnce(fileId: string, ctx: GasCallContext): Promise<FilePayload> {
  const base = ctx.url ?? GAS_URL;
  if (!base) throw new NetworkError('VITE_GAS_URL이 설정되지 않았습니다.');
  const url = new URL(base);
  url.searchParams.set('action', 'file');
  url.searchParams.set('deviceId', ctx.deviceId);
  url.searchParams.set('fileId', fileId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? timeoutFor('file'));
  try {
    const response = await (ctx.fetchImpl ?? fetch)(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    return parsePdfBody(await response.text());
  } catch (error) {
    if (error instanceof GasError || error instanceof NetworkError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NetworkError('요청 시간이 초과되었습니다.');
    }
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

async function once<T>(action: string, payload: unknown, ctx: GasCallContext): Promise<T> {
  const url = ctx.url ?? GAS_URL;
  if (!url) throw new NetworkError('VITE_GAS_URL이 설정되지 않았습니다.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? timeoutFor(action));
  try {
    const response = await (ctx.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        deviceId: ctx.deviceId,
        adminToken: ctx.adminToken,
        payload: payload ?? {},
      }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const json = (await response.json()) as GasOk<T> | GasFail;
    if (!json.ok) {
      throw new GasError(json.error.code, json.error.message);
    }
    return json.data;
  } catch (error) {
    if (error instanceof GasError || error instanceof NetworkError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NetworkError('요청 시간이 초과되었습니다.');
    }
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}
