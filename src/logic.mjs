export function unwrapRpc(value) {
  // oRPC envelopes generally look like {json: payload}.
  let v = value;
  for (let i = 0; i < 3; i++) {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.json !== undefined) v = v.json;
    else break;
  }
  return v;
}

export function readSerials(response) {
  const d = unwrapRpc(response);
  const rows = Array.isArray(d) ? d : d?.serials;
  if (!Array.isArray(rows)) throw new Error('serials 응답에 시리얼 배열이 없습니다. 실제 API 응답을 확인해야 합니다.');
  const set = new Set();
  for (const item of rows) {
    const raw = typeof item === 'number' || typeof item === 'string' ? item : item?.serial;
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a,b)=>a-b);
}

export function readFirstOwner(response) {
  const d = unwrapRpc(response);
  const transfers = d?.transfers;
  if (!Array.isArray(transfers)) throw new Error('serialTransfers 응답에 transfers 배열이 없습니다.');
  if (!transfers.length) return null;
  // objekt.top returns newest first. When timestamps are available, sort
  // explicitly, so the extraction does not depend on array presentation.
  const dated = transfers.every(t => t && Number.isFinite(Date.parse(t.timestamp)));
  const oldest = dated
    ? [...transfers].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp))[0]
    : transfers.at(-1);
  const wallet = String(oldest?.to || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error('최초 수령자의 지갑 주소 형식이 올바르지 않습니다.');
  return {
    wallet,
    nickname: typeof oldest.nickname === 'string' ? oldest.nickname.trim().slice(0,100) : '',
    tokenId: d?.tokenId != null ? String(d.tokenId) : '',
    timestamp: typeof oldest.timestamp === 'string' ? oldest.timestamp : '',
  };
}

export function shardForWallet(wallet) {
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error('invalid wallet');
  return (parseInt(wallet.slice(2,4),16) % 64).toString().padStart(2,'0');
}

export function incrementBuyer(base, owner, slug, quantity = 1) {
  const next = structuredClone(base ?? {nickname:'', total:0, bySlug:{}});
  if (owner.nickname) next.nickname = owner.nickname;
  next.total = Number(next.total||0) + quantity;
  next.bySlug ||= {};
  next.bySlug[slug] = Number(next.bySlug[slug]||0) + quantity;
  return next;
}

export function rankRows(shards, slugs) {
  const included = new Set(slugs);
  const byWallet = new Map();
  for (const shard of shards) {
    for (const [wallet,entry] of Object.entries(shard?.buyers||{})) {
      const total = Object.entries(entry?.bySlug||{}).reduce((sum,[slug,count]) => sum+(included.has(slug)?Number(count)||0:0),0);
      if(total > 0) byWallet.set(wallet,{wallet,nickname:entry.nickname || wallet,total,bySlug:entry.bySlug});
    }
  }
  return [...byWallet.values()].sort((a,b)=>b.total-a.total || a.wallet.localeCompare(b.wallet));
}
