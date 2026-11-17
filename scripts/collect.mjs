// Collect first receivers for the 30 selected tripleS objekts.
// Store each (collection, serial) once; give new serials priority and
// rotate the starting collection to keep small batches fair.
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
initializeApp({ credential: cert(credentials) });
const db = getFirestore();

const MAX = Math.max(1, Math.min(Number(process.env.MAX_ITEMS) || 18, 150));
const PAUSE = Math.max(900, Number(process.env.REQUEST_DELAY_MS) || DEFAULT_DELAY_MS);
const CATALOG_TTL = 15 * 60 * 1000; // scheduled runs refresh every 15 min
const FORCE_CATALOG_REFRESH = process.env.FORCE_CATALOG_REFRESH === '1'; // manual sync bypasses TTL
const iso = () => new Date().toISOString();
const safeError = e => String(e?.message || e).slice(0, 240);
const states = new Map();
const errors = [];
const clock = Date.now();

const statusRef = db.doc('public/status');
const statusSnapshot = await statusRef.get();
const previousStatus = statusSnapshot.exists ? statusSnapshot.data() : {};
let scanCursor = Math.max(0, Math.trunc(Number(previousStatus?.scanCursor) || 0));

for (const c of COLLECTIONS) {
  const ref = db.doc(`collectionState/${c.slug}`);
  const snap = await ref.get();
  const old = snap.exists ? snap.data() : {};
  const state = {
    slug: c.slug,
    member: c.member,
    number: c.number,
    serials: Array.isArray(old.serials) ? old.serials : [],
    done: Array.isArray(old.done) ? old.done : [],
    urgent: Array.isArray(old.urgent) ? old.urgent : [],
    lastCatalogMs: Number(old.lastCatalogMs || 0),
    error: old.error || '',
  };
  const done = new Set(state.done.map(Number));
  let dirty = !snap.exists;

  if (FORCE_CATALOG_REFRESH || clock - state.lastCatalogMs >= CATALOG_TTL || state.serials.length === 0) {
    try {
      const freshList = await listSerials(c.slug);
      const known = new Set(state.serials.map(Number));
      const newlyMinted = freshList.filter(n => !known.has(n));
      if (known.size > 0 && newlyMinted.length > 0) {
        state.urgent = [...new Set([...state.urgent, ...newlyMinted])];
        console.log(`NEW ${c.slug}: ${newlyMinted.length} serial(s) discovered`);
      }
      state.serials = [...new Set([...known, ...freshList])].sort((a, b) => a - b);
      state.lastCatalogMs = Date.now();
      state.error = '';
      console.log(`${c.member} ${c.number}: ${freshList.length} serials reported`);
    } catch (e) {
      state.error = safeError(e);
      errors.push(`${c.member} ${c.number}: ${state.error}`);
      console.log('catalog error:', c.slug, state.error);
    }
    dirty = true;
    await delay(200); // avoid bursts of catalog requests
  }
  // Urgent queue survives between jobs, so newly issued serials stay ahead
  // of the historical backlog until they have been successfully stored.
  state.urgent = [...new Set(state.urgent.map(Number))]
    .filter(n => Number.isSafeInteger(n) && n > 0 && !done.has(n));
  const urgentSet = new Set(state.urgent);
  const pending = [
    ...state.urgent,
    ...state.serials.filter(n => !done.has(n) && !urgentSet.has(n)),
  ];
  states.set(c.slug, { c, ref, state, done, pending, dirty });
}

// Rotate the start index across runs: when MAX_ITEMS < 30, no member starves.
const slots = [...states.values()];
const results = [];
const MAX_ATTEMPTS = Math.min(180, MAX + Math.max(12, Math.ceil(MAX / 4)));
let attempts = 0;
let consecutiveErrors = 0;
if (slots.length) scanCursor %= slots.length;
while (results.length < MAX && attempts < MAX_ATTEMPTS && slots.length && consecutiveErrors < 3) {
  let work = false;
  let nextCursor = scanCursor;
  for (let i = 0; i < slots.length && results.length < MAX && attempts < MAX_ATTEMPTS && consecutiveErrors < 3; i++) {
    const index = (scanCursor + i) % slots.length;
    const slot = slots[index];
    const serial = slot.pending.shift();
    if (serial === undefined) continue;
    attempts++;
    work = true;
    nextCursor = (index + 1) % slots.length;
    try {
      const owner = await firstReceiver(slot.c.slug, serial);
      if (!owner) {
        errors.push(`${slot.c.member} ${slot.c.number} #${serial}: 이전 이력 없음 (다음 실행에서 재시도)`);
      } else {
        results.push({ slug: slot.c.slug, serial, member: slot.c.member, ...owner });
        slot.done.add(serial);
        slot.dirty = true;
        consecutiveErrors = 0;
      }
    } catch (e) {
      errors.push(`${slot.c.member} ${slot.c.number} #${serial}: ${safeError(e)}`);
      consecutiveErrors++;
    }
    await delay(PAUSE);
  }
  scanCursor = nextCursor;
  if (!work) break;
}

// Update each aggregate shard only once per run, not once per serial.
const shardBuyers = new Map();
for (const item of results) {
  const shard = shardForWallet(item.wallet);
  if (!shardBuyers.has(shard)) {
    const snap = await db.doc(`rankShards/${shard}`).get();
    shardBuyers.set(shard, snap.exists ? structuredClone(snap.data()?.buyers || {}) : {});
  }
  const buyers = shardBuyers.get(shard);
  buyers[item.wallet] = incrementBuyer(buyers[item.wallet], item, item.slug);
}
for (const [shard, buyers] of shardBuyers) {
  const bytes = Buffer.byteLength(JSON.stringify(buyers), 'utf8');
  if (bytes > 850000) throw new Error(`rankShards/${shard}: ${bytes} bytes — 문서 크기 한계에 가까움`);
}

const batch = db.batch();
for (const item of results) {
  const { slug, serial, wallet, nickname, tokenId, timestamp } = item;
  // create() rejects duplicate serials to protect buyer counts.
  batch.create(db.doc(`receipts/${slug}__${serial}`), {
    slug, serial, wallet, nickname, tokenId, timestamp, recordedAt: iso(),
  });
}
for (const [shard, buyers] of shardBuyers) {
  batch.set(db.doc(`rankShards/${shard}`), { buyers, updatedAt: iso() });
}
const progress = [];
for (const slot of slots) {
  slot.state.done = [...slot.done].sort((a, b) => a - b);
  slot.state.urgent = slot.state.urgent.filter(n => !slot.done.has(n));
  const total = slot.state.serials.length;
  progress.push({
    slug: slot.c.slug, member: slot.c.member, number: slot.c.number,
    total, done: slot.state.done.length,
    remaining: Math.max(0, total - slot.state.done.length), error: slot.state.error || '',
  });
  if (slot.dirty) batch.set(slot.ref, slot.state);
}
batch.set(statusRef, {
  source: 'objekt.top',
  lastRunAt: iso(),
  scanCursor,
  version: FieldValue.increment(results.length ? 1 : 0),
  totalCollected: FieldValue.increment(results.length),
  latestBatch: results.length,
  collections: progress,
  errors: errors.slice(0, 8),
}, { merge: true });
await batch.commit();
console.log(JSON.stringify({
  collected: results.length,
  attempted: attempts,
  totalPending: progress.reduce((n, c) => n + c.remaining, 0),
  newUrgentRemaining: slots.reduce((n, s) => n + s.state.urgent.length, 0),
  nextScanCursor: scanCursor,
  errors: errors.slice(0, 8),
}, null, 2));
if (!results.length && errors.length) process.exitCode = 1;
