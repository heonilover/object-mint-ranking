import { listSerials, firstReceiver } from '../src/objekt-api.mjs';
import { COLLECTIONS } from '../src/collections.mjs';
const slug = process.env.SLUG || COLLECTIONS[0].slug;
const serial = Number(process.env.SERIAL||1);
if (!COLLECTIONS.some(c=>c.slug===slug) || !Number.isSafeInteger(serial) || serial<1) {
  throw new Error('SLUG/SERIAL 값을 확인해 주세요');
}
console.log('검증할 오브젝트:',slug);
try {
  const nums=await listSerials(slug);
  console.log('발행 시리얼 수:',nums.length, '앞 10개:',nums.slice(0,10));
  if (!nums.includes(serial)) console.log(`안내: #${serial}은 serials 목록에 없습니다.`);
  const result=await firstReceiver(slug,serial);
  console.log('시리얼:',serial,'최초 수령자:',result||'기록 없음');
} catch(e) {
  console.error('실제 API 연결 검증 실패:',e.message);
  process.exitCode=1;
}
