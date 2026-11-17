// Full-backlog, checkpointed first-receiver scanner for Cream02 CC372Z–CC374Z.
// One run processes ALL uncollected serials discovered at its start (not just 72).
// Requests are moderately concurrent, but globally rate paced to protect objekt.top.
// GitHub Actions concurrency should serialize runs of this workflow.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../src/collections.mjs';
import { listSerials, firstReceiver, delay } from '../src/objekt-api.mjs';
import { shardForWallet } from '../src/logic.mjs';

const key = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!key) throw new Error('GitHub Actions Secret FIREBASE_SERVICE_ACCOUNT_JSON is missing.');
let credentials;
try { credentials = JSON.parse(key); }
catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
initializeApp({ credential: cert(credentials) });
const db = getFirestore();

const numberEnv = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.min(Math.trunc(n), max) : fallback;
};
// No MAX_ITEMS limit. The old Worker can continue sending max_items='72': it is ignored.
const CONCURRENCY = numberEnv('SCAN_CONCURRENCY', 10, 1, 20);
const SPACING_MS = numberEnv('REQUEST_SPACING_MS', 300, 100, 10000);
const CHUNK_SIZE = numberEnv('CHECKPOINT_SIZE', 80, 10, 120);
const MAX_RUNTIME_MINUTES = numberEnv('MAX_RUNTIME_MINUTES', 315, 5, 325);
const CATALOG_TTL_MS = 15 * 60 * 1000;
const FORCE_CATALOG_REFRESH = process.env.FORCE_CATALOG_REFRESH === '1';
const began = Date.now();
const deadline = began + MAX_RUNTIME_MINUTES * 60_000;
const iso = () => new Date().toISOString();
const safeError = e => String(e?.message || e).slice(0, 220);
const statusRef = db.doc('public/status');
const errors = [];
const reportError = value => {
  errors.push(value);
  if (errors.length > 40) errors.shift();
  console.error(value);
};

// Share a single start-rate limiter across 30 catalog requests and all transfers.
// A few requests may be in flight, but they do NOT all start simultaneously.
let nextRequestAt = Date.now();
async function paced(action) {
  const start = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = start + SPACING_MS;
  if (start > Date.now()) await delay(start - Date.now());
  return action();
}
async function pool(items, worker, concurrency = CONCURRENCY) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

const states = new Map();
const snapshots = await Promise.all(COLLECTIONS.map(c => db.doc(`collectionState/${c.slug}`).get()));
for (let i = 0; i < COLLECTIONS.length; i++) {
  const c = COLLECTIONS[i];
  const snap = snapshots[i];
  const previous = snap.exists ? snap.data() : {};
  const serials = [...new Set((Array.isArray(previous?.serials) ? previous.serials : [])
    .map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].sort((a,b) => a-b);
  const done = new Set((Array.isArray(previous?.done) ? previous.done : [])
    .map(Number).filter(n => Number.isSafeInteger(n) && n > 0));
  const urgent = [...new Set((Array.isArray(previous?.urgent) ? previous.urgent : [])
    .map(Number).filter(n => Number.isSafeInteger(n) && n > 0 && !done.has(n)))];
  states.set(c.slug, {
    c, ref: db.doc(`collectionState/${c.slug}`), done, dirty: !snap.exists,
    state: {
      slug: c.slug, member: c.member, number: c.number, serials, urgent,
      lastCatalogMs: Number(previous?.lastCatalogMs || 0), error: previous?.error || '',
    },
    pending: [],
  });
}
const slots = [...states.values()];

// Start status is visible while the scanner is working; it does NOT mean completion.
await statusRef.set({ syncRunning: true, lastStartedAt: iso(), lastError: '' }, { merge: true });
let collected = 0;
let attempted = 0;
let chunksCommitted = 0;
let lastKnownPending = 0;
let fatal = null;

function progressFor(extraDone = new Map()) {
  return slots.map(slot => {
    const nextDone = new Set(slot.done);
    for (const serial of extraDone.get(slot.c.slug) || []) nextDone.add(serial);
    const total = slot.state.serials.length;
    return {
      slug: slot.c.slug, member: slot.c.member, number: slot.c.number,
      total, done: nextDone.size,
      remaining: slot.state.serials.filter(n => !nextDone.has(n)).length,
      error: slot.state.error || '',
    };
  });
}

// Each checkpoint is an atomic batch: receipt creation, increments, state and
// progress commit together. A crash between checkpoints only re-fetches that chunk.
// FieldValue.increment and merge eliminate costly shard reads/replacements.
async function checkpoint(items, { final = false } = {}) {
  const additions = new Map();
  const shardUpdates = new Map();
  for (const item of items) {
    if (!additions.has(item.slug)) additions.set(item.slug, new Set());
    additions.get(item.slug).add(item.serial);
    const shard = shardForWallet(item.wallet);
    if (!shardUpdates.has(shard)) shardUpdates.set(shard, new Map());
    const buyers = shardUpdates.get(shard);
    if (!buyers.has(item.wallet)) buyers.set(item.wallet, { nickname: '', total: 0, bySlug: new Map() });
    const buyer = buyers.get(item.wallet);
    buyer.total++;
    buyer.bySlug.set(item.slug, (buyer.bySlug.get(item.slug) || 0) + 1);
    if (item.nickname) buyer.nickname = item.nickname;
  }
  const batch = db.batch();
  const timestamp = iso();
  for (const item of items) {
    batch.create(db.doc(`receipts/${item.slug}__${item.serial}`), {
      slug: item.slug, serial: item.serial, wallet: item.wallet,
      nickname: item.nickname, tokenId: item.tokenId, timestamp: item.timestamp,
      recordedAt: timestamp,
    });
  }
  for (const [shard, buyerMap] of shardUpdates) {
    const buyers = {};
    for (const [wallet, owner] of buyerMap) {
      const bySlug = {};
      for (const [slug, count] of owner.bySlug) bySlug[slug] = FieldValue.increment(count);
      buyers[wallet] = { total: FieldValue.increment(owner.total), bySlug };
      if (owner.nickname) buyers[wallet].nickname = owner.nickname;
    }
    batch.set(db.doc(`rankShards/${shard}`), { buyers, updatedAt: timestamp }, { merge: true });
  }
  for (const slot of slots) {
    const newlyDone = additions.get(slot.c.slug);
    if (!slot.dirty && !newlyDone?.size) continue;
    const mergedDone = new Set(slot.done);
    for (const serial of newlyDone || []) mergedDone.add(serial);
    batch.set(slot.ref, {
      ...slot.state,
      done: [...mergedDone].sort((a,b) => a-b),
      urgent: slot.state.urgent.filter(n => !mergedDone.has(n)),
    });
  }
  const progress = progressFor(additions);
  const remaining = progress.reduce((sum, item) => sum + item.remaining, 0);
  batch.set(statusRef, {
    source: 'objekt.top',
    // The existing website treats lastRunAt as 'finished'. Update it ONLY
    // after the final checkpoint, not during intermediate progress writes.
    ...(final ? { lastRunAt: timestamp } : {}),
    latestBatch: collected + items.length, // cumulative in this invocation
    totalCollected: FieldValue.increment(items.length),
    version: FieldValue.increment(items.length ? 1 : 0),
    syncRunning: !final, lastCompletedAt: final ? timestamp : null,
    collections: progress, errors: errors.slice(-8),
  }, { merge: true });
  await batch.commit();
  for (const slot of slots) {
    for (const serial of additions.get(slot.c.slug) || []) slot.done.add(serial);
    slot.dirty = false;
    slot.state.urgent = slot.state.urgent.filter(n => !slot.done.has(n));
  }
  collected += items.length;
  lastKnownPending = remaining;
  chunksCommitted++;
  console.log(`CHECKPOINT: +${items.length}; this run ${collected}; ${remaining} remaining; ${attempted} attempts`);
}

try {
  // Refresh all catalog lists, in parallel but rate paced. Existing Firestore
  // states are used if an individual catalog request temporarily fails.
  await pool(slots, async slot => {
    if (!FORCE_CATALOG_REFRESH && slot.state.serials.length && Date.now() - slot.state.lastCatalogMs < CATALOG_TTL_MS) return;
    try {
      const serials = await paced(() => listSerials(slot.c.slug));
      const old = new Set(slot.state.serials);
      const newest = serials.filter(serial => !old.has(serial) && !slot.done.has(serial));
      // Give fresh mint records priority over historical backlog.
      if (old.size && newest.length) slot.state.urgent.push(...newest);
      slot.state.serials = [...new Set([...slot.state.serials, ...serials])].sort((a,b)=>a-b);
      slot.state.urgent = [...new Set(slot.state.urgent)];
      slot.state.lastCatalogMs = Date.now();
      slot.state.error = '';
      slot.dirty = true;
      console.log(`CATALOG ${slot.c.slug}: ${serials.length} reported, ${slot.state.serials.length} total`);
    } catch (e) {
      slot.state.error = safeError(e);
      slot.dirty = true;
      reportError(`CATALOG ${slot.c.slug}: ${slot.state.error}`);
    }
  });

  for (const slot of slots) {
    const urgentSet = new Set(slot.state.urgent);
    slot.pending = [
      ...slot.state.urgent.filter(n => !slot.done.has(n)),
      ...slot.state.serials.filter(n => !slot.done.has(n) && !urgentSet.has(n)),
    ];
  }
  const tasks = [];
  // Round robin across members so checkpoints display balanced ranking progress.
  let workLeft = true;
  while (workLeft) {
    workLeft = false;
    for (const slot of slots) {
      const serial = slot.pending.shift();
      if (serial === undefined) continue;
      workLeft = true;
      tasks.push({ slot, serial });
    }
  }
  console.log(`FULL-SYNC: ${tasks.length} uncollected serials; ${CONCURRENCY} concurrent; ${SPACING_MS}ms start spacing; checkpoints of ${CHUNK_SIZE}`);
  await checkpoint([]); // save the freshly read catalogs and initial progress
  let stoppedEarly = false;
  for (let start = 0; start < tasks.length; start += CHUNK_SIZE) {
    // Leave time for the last Firebase checkpoint before GitHub's job timeout.
    if (Date.now() >= deadline - 60_000) {
      stoppedEarly = true;
      reportError('TIME BUDGET: will resume remaining serials on the next run.');
      break;
    }
    const chunk = tasks.slice(start, start + CHUNK_SIZE);
    const accepted = [];
    let failures = 0;
    await pool(chunk, async ({slot, serial}) => {
      try {
        const first = await paced(() => firstReceiver(slot.c.slug, serial));
        if (!first) {
          failures++;
          reportError(`${slot.c.slug} #${serial}: no transfer history yet`);
          return;
        }
        accepted.push({ slug: slot.c.slug, serial, ...first });
      } catch (e) {
        failures++;
        reportError(`${slot.c.slug} #${serial}: ${safeError(e)}`);
      } finally {
        attempted++;
      }
    });
    // Never discard successful reads because other requests failed.
    if (accepted.length) await checkpoint(accepted);
    if (failures >= Math.max(8, Math.ceil(chunk.length / 2))) {
      stoppedEarly = true;
      reportError(`TOO MANY ERRORS: ${failures}/${chunk.length}; stop to protect the API, retry on next run.`);
      break;
    }
  }
  await checkpoint([], { final: true });
  if (stoppedEarly || lastKnownPending || errors.length) {
    // An incomplete run must not be reported as a fully successful full scan.
    console.log(`INCOMPLETE: ${lastKnownPending} remaining, ${errors.length} recent errors`);
    process.exitCode = 1;
  } else {
    console.log('COMPLETE: all currently discoverable serials were processed.');
  }
} catch (e) {
  fatal = e;
  console.error('FATAL:', safeError(e));
  process.exitCode = 1;
} finally {
  // The last committed checkpoint is durable even if a subsequent chunk fails.
  // Mark the site as not running, including if Firestore checkpoint failed.
  try {
    await statusRef.set({
      syncRunning: false, lastStoppedAt: iso(),
      lastError: fatal ? safeError(fatal) : (process.exitCode ? (errors.at(-1) || 'Incomplete sync') : ''),
    }, { merge: true });
  } catch (e) { console.error('Could not finalize status:', safeError(e)); process.exitCode = 1; }
  console.log(JSON.stringify({ collected, attempted, remaining: lastKnownPending, checkpoints: chunksCommitted, errors: errors.slice(-8) }, null, 2));
}
