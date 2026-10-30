import { GAS_URL } from '../config';
import type { GasFail, GasOk } from './types';

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

const RETRY_ACTIONS = new Set(['tree', 'config', 'file']);

export function timeoutFor(action: string): number {
  if (action === 'file') return 300_000;
  if (action === 'tree') return 240_000;
  if (action === 'send' || action === 'stage') return 330_000;
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
