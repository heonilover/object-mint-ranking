import test from 'node:test';
import assert from 'node:assert/strict';
import { readSerials, readFirstOwner, shardForWallet, incrementBuyer, rankRows } from '../src/logic.mjs';
import { callRpc } from '../src/objekt-api.mjs';
const wallet='0xb4b40f86c6c1066f2cd43e16487e99b0dca3835e';
test('serials handles oRPC shape and duplicates',()=>{
  assert.deepEqual(readSerials({json:{serials:[3,1,2,2,'4'],spun:[]}}),[1,2,3,4]);
});
test('oldest receiver from user shared payload is KiwiKoko',()=>{
  const x=readFirstOwner({json:{tokenId:'20629058',transfers:[{to:wallet,timestamp:'2026-02-09T01:00:12.000Z',nickname:'KiwiKoko'}]}});
  assert.equal(x.nickname,'KiwiKoko'); assert.equal(x.wallet,wallet); assert.equal(x.tokenId,'20629058');
});
test('oldest timestamp wins despite reverse presentation',()=>{
  const x=readFirstOwner({json:{transfers:[{to:'0x'+'a'.repeat(40),timestamp:'2026-02-10T00:00:00Z'},{to:wallet,timestamp:'2026-02-09T00:00:00Z'}]}});
  assert.equal(x.wallet,wallet);
});
test('wallet-based grouping sums multiple obiects and preserves nickname',()=>{
  let buyer=incrementBuyer(undefined,{nickname:'KiwiKoko'},'binary02-hyerin-331z');
  buyer=incrementBuyer(buyer,{nickname:'KiwiKoko'},'binary02-chaewon-332z',2);
  assert.equal(buyer.total,3);
  assert.equal(buyer.bySlug['binary02-chaewon-332z'],2);
  const shards=[{buyers:{[wallet]:buyer,['0x'+'1'.repeat(40)]:{nickname:'B',total:1,bySlug:{'binary02-hyerin-331z':1}}}}];
  assert.equal(rankRows(shards,['binary02-chaewon-332z'])[0].nickname,'KiwiKoko');
  assert.equal(rankRows(shards,['binary02-hyerin-331z']).length,2);
});
test('wallet maps consistently to one of 64 shards',()=>{
  assert.match(shardForWallet(wallet),/^\d{2}$/);
  assert.ok(Number(shardForWallet(wallet))<64);
});
test('POST RPC sends observed oRPC body',async()=>{
  let request;
  await callRpc('serialTransfers',{collectionSlug:'binary02-hyerin-331z',serial:1},{fetchImpl: async(url,init)=>{request={url,init}; return {ok:true,text:async()=>'{"json":{"transfers":[]}}'};}});
  assert.equal(request.init.method,'POST');
  assert.deepEqual(JSON.parse(request.init.body),{json:{collectionSlug:'binary02-hyerin-331z',serial:1}});
});
