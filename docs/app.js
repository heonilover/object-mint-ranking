import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getFirestore,collection,doc,onSnapshot} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './config.js';

const ITEMS=[
  {slug:'binary02-hyerin-331z',member:'혜린',number:'BB331'},
  {slug:'binary02-hyerin-332z',member:'혜린',number:'BB332'},
  {slug:'binary02-soomin-331z',member:'수민',number:'BB331'},
  {slug:'binary02-soomin-332z',member:'수민',number:'BB332'},
  {slug:'binary02-hayeon-331z',member:'하연',number:'BB331'},
  {slug:'binary02-hayeon-332z',member:'하연',number:'BB332'},
  {slug:'binary02-chaewon-331z',member:'채원',number:'BB331'},
  {slug:'binary02-chaewon-332z',member:'채원',number:'BB332'},
];
const $=id=>document.getElementById(id);
const selected=new Set(ITEMS.map(x=>x.slug));
const state={shards:new Map(),status:null,search:'',shown:60,rows:[],ready:false};
const format=n=>Number(n||0).toLocaleString('ko-KR');
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortWallet=w=>String(w).slice(0,8)+'···'+String(w).slice(-6);

function paintChips(){
  $('chips').innerHTML=ITEMS.map(x=>`<button type="button" class="chip ${selected.has(x.slug)?'sel':''}" data-slug="${x.slug}" aria-pressed="${selected.has(x.slug)}"><span><b>${x.member}</b> <small>${x.number}</small></span><span class="check">${selected.has(x.slug)?'✓':'+'}</span></button>`).join('');
  $('chips').querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{
    const slug=btn.dataset.slug;
    selected.has(slug)?selected.delete(slug):selected.add(slug);
    state.shown=60;paintChips();render();
  }));
}

function computeRows(){
  const rows=[];
  for(const shard of state.shards.values()){
    for(const [wallet,buyer] of Object.entries(shard?.buyers||{})){
      const count=Object.entries(buyer.bySlug||{}).reduce((sum,[slug,n])=>sum+(selected.has(slug)?Number(n)||0:0),0);
      if(count>0)rows.push({wallet,nickname:buyer.nickname||wallet,count,bySlug:buyer.bySlug||{}});
    }
  }
  rows.sort((a,b)=>b.count-a.count||a.wallet.localeCompare(b.wallet));
  let prev=0,rank=0;
  rows.forEach((r,i)=>{if(r.count!==prev)rank=i+1;r.rank=rank;prev=r.count});
  return rows;
}

function render(){
  const filtered=state.rows=computeRows();
  const search=state.search.trim().toLocaleLowerCase();
  const visible=search?filtered.filter(x=>x.nickname.toLocaleLowerCase().includes(search)||x.wallet.includes(search)):filtered;
  $('metricBuyers').textContent=format(filtered.length);
  const progress=state.status?.collections||[];
  const included=progress.filter(p=>selected.has(p.slug));
  const done=included.reduce((s,p)=>s+(Number(p.done)||0),0);
  const total=included.reduce((s,p)=>s+(Number(p.total)||0),0);
  $('metricDone').textContent=format(done);
  $('metricTotal').textContent=`전체 ${format(total)}장 중`;
  const pct=total>0?Math.min(100,done/total*100):0;
  $('progressLabel').textContent=`선택한 ${selected.size}종 · ${format(done)} / ${format(total)} 시리얼 확인`;
  $('progressPct').textContent=total?`${pct.toFixed(1)}%`:'—';
  $('progressFill').style.width=pct+'%';
  if(state.status?.lastRunAt){
    try { const date=new Date(state.status.lastRunAt);$('metricTime').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date); }catch{$('metricTime').textContent='—'}
    $('metricBatch').textContent=`최근 ${format(state.status.latestBatch)}장 새로 저장`;
  }
  const problems=[...(state.status?.errors||[]),...included.filter(p=>p.error).map(p=>`${p.member} ${p.number}: ${p.error}`)];
  if(problems.length){$('alert').hidden=false;$('alert').textContent=`수집 문제: ${problems.slice(0,2).join(' / ')}`;}
  else if(state.ready){$('alert').hidden=true;}
  const body=$('rankBody');
  if(!state.ready){body.innerHTML='<tr><td colspan="4" class="empty">Firebase 연결을 확인하고 있어...</td></tr>';return;}
  if(!selected.size){body.innerHTML='<tr><td colspan="4" class="empty">집계할 오브젝트를 선택해 줘.</td></tr>';return;}
  if(!visible.length){body.innerHTML='<tr><td colspan="4" class="empty">아직 저장된 구매량 기록이 없거나 검색 결과가 없어.<br>GitHub Actions에서 데이터 수집을 실행해 줘.</td></tr>';$('loadWrap').hidden=true;return;}
  const max=Math.min(state.shown,visible.length);
  body.innerHTML=visible.slice(0,max).map((r)=>`<tr><td><span class="rank-number ${r.rank<=3?'top':''}">${r.rank}</span></td><td><div class="who"><strong>${escapeHTML(r.nickname)}</strong><span title="${escapeHTML(r.wallet)}">${shortWallet(r.wallet)}</span></div></td><td class="count-col"><span class="amount">${format(r.count)}장</span></td><td><button class="expand" type="button" data-wallet="${r.wallet}" aria-label="${escapeHTML(r.nickname)} 세부 내역">⌄</button></td></tr>`).join('');
  for(const btn of body.querySelectorAll('.expand')) btn.addEventListener('click',()=>{
    const row=visible.find(v=>v.wallet===btn.dataset.wallet);
    const existing=btn.closest('tr').nextElementSibling;
    if(existing?.classList.contains('detail-row')){existing.remove();btn.textContent='⌄';return;}
    for(const x of body.querySelectorAll('.detail-row'))x.remove();
    for(const x of body.querySelectorAll('.expand'))x.textContent='⌄';
    const next=document.createElement('tr');next.className='detail-row';
    const grid=ITEMS.filter(i=>selected.has(i.slug)).map(i=>`<div class="detail-item"><span>${i.member} ${i.number}</span><b>${format(row.bySlug[i.slug]||0)}장</b></div>`).join('');
    next.innerHTML=`<td class="detail-cell" colspan="4"><div class="detail-grid">${grid}</div></td>`;
    btn.closest('tr').after(next);btn.textContent='⌃';
  });
  $('loadWrap').hidden=visible.length<=max;
  $('moreBtn').textContent=`더 보기 (${format(max)} / ${format(visible.length)})`;
}

function setFailure(message){
  $('liveDot').className='live-dot fail'; $('liveLabel').textContent='연결 실패';
  $('alert').hidden=false;$('alert').textContent=message;
  state.ready=true;render();
  $('alert').hidden=false;$('alert').textContent=message;
}

$('allBtn').addEventListener('click',()=>{ITEMS.forEach(x=>selected.add(x.slug));state.shown=60;paintChips();render()});
$('noneBtn').addEventListener('click',()=>{selected.clear();paintChips();render()});
$('searchInput').addEventListener('input',e=>{state.search=e.target.value;state.shown=60;render()});
$('moreBtn').addEventListener('click',()=>{state.shown+=100;render()});
$('csvBtn').addEventListener('click',()=>{
  const items=state.rows.filter(r=>!state.search || r.nickname.toLowerCase().includes(state.search.toLowerCase())||r.wallet.includes(state.search.toLowerCase()));
  const safe=v=>{let t=String(v??'');if(/^[=+\-@]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
  const heads=['순위','닉네임','지갑','합계',...ITEMS.filter(x=>selected.has(x.slug)).map(x=>`${x.member} ${x.number}`)];
  const rows=[heads,...items.map(x=>[x.rank,x.nickname,x.wallet,x.count,...ITEMS.filter(i=>selected.has(i.slug)).map(i=>x.bySlug[i.slug]||0)])];
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='objekt-first-owner-ranking.csv';link.click();URL.revokeObjectURL(link.href);
});
paintChips();

if(!firebaseConfig.projectId || !firebaseConfig.apiKey || !firebaseConfig.appId){
  setFailure('Firebase 설정이 비어 있어. docs/config.js에 Firebase 웹 앱 설정값을 입력해 줘. 실제 랭킹은 아직 연결되지 않았어.');
}else{
  try{
    const db=getFirestore(initializeApp(firebaseConfig));
    onSnapshot(doc(db,'public','status'),s=>{
      state.status=s.exists()?s.data():null;
      $('liveDot').className='live-dot ok';
      $('liveLabel').textContent='Firestore 연결됨';
      state.ready=true;render();
    },error=>setFailure('Firestore 상태 조회 실패: '+error.message));
    onSnapshot(collection(db,'rankShards'),s=>{
      for(const change of s.docChanges()){
        if(change.type==='removed')state.shards.delete(change.doc.id);
        else state.shards.set(change.doc.id,change.doc.data());
      }
      state.ready=true;render();
    },error=>setFailure('랭킹 데이터 조회 실패: '+error.message));
  }catch(error){setFailure('Firebase 초기화 실패: '+error.message)}
}
