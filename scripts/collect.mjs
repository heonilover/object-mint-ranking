import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../src/collections.mjs';
import { listSerials, firstReceiver, delay, DEFAULT_DELAY_MS } from '../src/objekt-api.mjs';
import { shardForWallet, incrementBuyer } from '../src/logic.mjs';

const key = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!key) throw new Error('GitHub Actions Secret: FIREBASE_SERVICE_ACCOUNT_JSON 설정이 필요합니다.');
let credentials;
try { credentials = JSON.parse(key); }
catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.'); }
initializeApp({credential:cert(credentials)});
const db=getFirestore();

const MAX = Math.max(1,Math.min(Number(process.env.MAX_ITEMS)||72,150));
const PAUSE = Math.max(900,Number(process.env.REQUEST_DELAY_MS)||DEFAULT_DELAY_MS);
const CATALOG_TTL=45*60*1000;
const iso=()=>new Date().toISOString();
const safeError=e=>String(e?.message||e).slice(0,240);
const states=new Map();
const errors=[];

for(const c of COLLECTIONS) {
  const ref=db.doc(`collectionState/${c.slug}`);
  const snap=await ref.get();
  const old=snap.exists?snap.data():{};
  const state={
    slug:c.slug, member:c.member, number:c.number,
    serials:Array.isArray(old.serials)?old.serials:[],
    done:Array.isArray(old.done)?old.done:[],
    lastCatalogMs:Number(old.lastCatalogMs||0),
    error:old.error||'',
  };
  if(Date.now()-state.lastCatalogMs>CATALOG_TTL || state.serials.length===0) {
    try {
      const newest=await listSerials(c.slug);
      const all=new Set([...state.serials,...newest]);
      state.serials=[...all].sort((a,b)=>a-b);
      state.lastCatalogMs=Date.now();
      state.error='';
      console.log(`${c.member} ${c.number}: ${newest.length} serials reported`);
    } catch(e) {
      state.error=safeError(e);
      errors.push(`${c.member} ${c.number}: ${state.error}`);
      console.log('catalog error:',c.slug,state.error);
    }
    await delay(200);
  }
  const done=new Set(state.done.map(Number));
  const pending=state.serials.filter(n=>!done.has(n));
  states.set(c.slug,{c,ref,state,done,pending});
}

// Round-robin scanning keeps the four members and eight cards comparable.
const results=[];
const attempted=new Set();
let consecutiveErrors=0;
while(results.length < MAX) {
  let work=false;
  for(const [slug,slot] of states) {
    if (results.length>=MAX || consecutiveErrors>=3) break;
    let serial;
    while(slot.pending.length) {
      const n=slot.pending.shift();
      if (!attempted.has(`${slug}/${n}`)) {serial=n; break;}
    }
    if(serial===undefined) continue;
    work=true;
    attempted.add(`${slug}/${serial}`);
    try {
      const owner=await firstReceiver(slug,serial);
      if (!owner) {
        errors.push(`${slot.c.member} ${slot.c.number} #${serial}: 이전 이력 없음`);
      } else {
        results.push({slug,serial,member:slot.c.member,...owner});
        consecutiveErrors=0;
      }
    } catch(e) {
      errors.push(`${slot.c.member} ${slot.c.number} #${serial}: ${safeError(e)}`);
      consecutiveErrors++;
    }
    await delay(PAUSE);
  }
  if(!work || consecutiveErrors>=3) break;
}

// Read only the small number of aggregate shards touched by this batch.
const shardBuyers=new Map();
for (const item of results) {
  const shard=shardForWallet(item.wallet);
  if(!shardBuyers.has(shard)) {
    const snap=await db.doc(`rankShards/${shard}`).get();
    shardBuyers.set(shard,snap.exists ? structuredClone(snap.data()?.buyers||{}): {});
  }
  const buyers=shardBuyers.get(shard);
  buyers[item.wallet]=incrementBuyer(buyers[item.wallet],item,item.slug);
}
for (const [shard,buyers] of shardBuyers) {
  const bytes=Buffer.byteLength(JSON.stringify(buyers),'utf8');
  if(bytes>850000) throw new Error(`rankShards/${shard}: ${bytes} bytes — 문서 크기 한계에 가까움`);
}

const batch=db.batch();
for(const item of results) {
  const {slug,serial,wallet,nickname,tokenId,timestamp}=item;
  // create() rejects a duplicate serial, preventing accidental double-counting.
  batch.create(db.doc(`receipts/${slug}__${serial}`),{
    slug,serial,wallet,nickname,tokenId,timestamp,recordedAt:iso()
  });
  states.get(slug).done.add(serial);
}
for(const [shard,buyers] of shardBuyers) {
  batch.set(db.doc(`rankShards/${shard}`),{buyers,updatedAt:iso()});
}
const progress=[];
for(const [,slot] of states) {
  slot.state.done=[...slot.done].sort((a,b)=>a-b);
  progress.push({slug:slot.c.slug,member:slot.c.member,number:slot.c.number,
    total:slot.state.serials.length,done:slot.state.done.length,
    remaining:Math.max(0,slot.state.serials.length-slot.state.done.length),
    error:slot.state.error||''});
  batch.set(slot.ref,slot.state);
}
batch.set(db.doc('public/status'),{
  source:'objekt.top',lastRunAt:iso(),
  version:FieldValue.increment(results.length?1:0),
  totalCollected:FieldValue.increment(results.length),
  latestBatch:results.length,
  collections:progress,
  errors:errors.slice(0,8),
},{merge:true});
await batch.commit();
console.log(JSON.stringify({collected:results.length,totalPending:progress.reduce((n,c)=>n+c.remaining,0),errors:errors.slice(0,8)},null,2));
if(!results.length && errors.length)process.exitCode=1;
