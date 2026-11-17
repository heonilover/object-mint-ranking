import { readSerials, readFirstOwner } from './logic.mjs';

const BASE = 'https://objekt.top/rpc/collections/';
export const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
export const DEFAULT_DELAY_MS = 1050;

export async function callRpc(name, input, options = {}) {
  if (!['serials','serialTransfers'].includes(name)) throw new Error('허용되지 않은 API 요청');
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 16000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),timeoutMs);
  try {
    // oRPC RPCLink uses POST with a {json:...} envelope by default.
    const response = await fetchImpl(BASE + name, {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json', 'User-Agent':'PersonalObjektMintRank/1.0 (low-frequency research)'},
      body:JSON.stringify({json:input}),
      signal:controller.signal,
      redirect:'error',
    });
    const body = await response.text();
    if (!response.ok) {
      const error = new Error(`${name}: HTTP ${response.status} — ${body.slice(0,230)}`);
      error.status = response.status;
      throw error;
    }
    try { return JSON.parse(body); }
    catch { throw new Error(`${name}: 서버 응답이 JSON이 아닙니다 (${body.slice(0,100)})`); }
  } finally { clearTimeout(timeout); }
}

export async function fetchWithRetry(name, input, options={}) {
  for(let attempt=0; attempt<3; attempt++) {
    try { return await callRpc(name,input,options); }
    catch (error) {
      // Do not hammer provider if access/validation is forbidden or invalid.
      if (![429,500,502,503,504].includes(error.status)) throw error;
      if(attempt===2) throw error;
      await delay(2500 * (attempt+1));
    }
  }
}

export async function listSerials(slug, options={}) {
  return readSerials(await fetchWithRetry('serials',{collectionSlug:slug},options));
}
export async function firstReceiver(slug, serial, options={}) {
  return readFirstOwner(await fetchWithRetry('serialTransfers',{collectionSlug:slug,serial},options));
}
