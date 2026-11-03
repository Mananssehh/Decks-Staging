// 012 capacity regression. Phase "before" (011 installed): seed the hosted-failure shape (175 principals,
// 149 songs, ~280 votes), run 100 fresh guests through a 10-connection pool with the hosted 8 s
// statement/lock timeouts, then capture exact aliases()/snapshot() results for every principal/event pair.
// Phase "after" (012 installed): require byte-identical results, then rerun the 100-guest flow and require
// zero errors, exact request/vote counts and coherent final snapshots.
import postgres from 'postgres';
import assert from 'node:assert/strict';
const phase=process.argv[2];if(phase!=='before'&&phase!=='after')throw Error('phase before|after');
const opts={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',onnotice:()=>{}};
const admin=postgres({...opts,max:2});
const pool=postgres({...opts,max:10}); // PostgREST-sized pool
let n=0;function ok(c:unknown,label:string){assert.ok(c,label);n++;console.log('PASS',label);}
const DJ='00000000-0000-4000-8000-00000000c001',EVENT='00000000-0000-4000-8000-00000000c002',CODE='CAPQA';
type R=Record<string,any>;
async function call(a:string,p:R):Promise<R>{
 return (await pool.begin(async q=>{await q`set local role service_role`;await q`select set_config('request.jwt.claim.role','service_role',true)`;
  await q`set local statement_timeout='8s'`;await q`set local lock_timeout='8s'`;return q`select public.guest_event_api(${a},${q.json(p)}) r`;}))[0].r;
}
const hex=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function timed<T>(f:()=>Promise<T>,lat:number[],errs:R){const t=performance.now();try{return await f();}catch(e:any){errs[e?.code??'thrown']=(errs[e?.code??'thrown']??0)+1;return null;}finally{lat.push(performance.now()-t);}}
const pct=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]??0);};
async function snapshotMs(actor:string,iterations=10){
 const r=await admin.begin(async q=>{const t0=(await q`select clock_timestamp() t`)[0].t;for(let i=0;i<iterations;i++)await q`select guest_runtime.snapshot(${actor},${EVENT})`;return (await q`select extract(epoch from clock_timestamp()-${t0}::timestamptz)*1000/${iterations} ms`)[0].ms;});
 return Number(r);
}
async function freshFlow(label:string,common:string,tag:string){
 const lat:R={join:[],snapshot:[],request:[],vote:[]},errs:R={},typed:R={};const t=performance.now();
 const guests=await Promise.all(Array.from({length:100},async(_,i)=>{
  const g=await timed(()=>call('join',{bootstrap:hex(),code:CODE,nickname:`Cap ${tag} ${i}`}),lat.join,errs);if(!g?.ok){typed[g?.error??'join']=(typed[g?.error??'join']??0)+1;return null;}
  const scope={event_id:EVENT,token:g.token};
  for(const [op,p] of [['snapshot',scope],['request',{...scope,idempotency_key:crypto.randomUUID(),source_platform:'itunes',source_song_id:`${(tag==="a"?700000:800000)+i}`,title:`Cap ${tag} ${i}`,artist:'Load'}],['vote',{...scope,request_id:common,value:1}],['snapshot',scope]] as const){
   const r=await timed(()=>call(op,p as R),lat[op],errs);if(!r?.ok){typed[`${op}:${r?.error??'sqlerror'}`]=(typed[`${op}:${r?.error??'sqlerror'}`]??0)+1;}
  }
  return {...g,scope};
 }));
 const secs=((performance.now()-t)/1000).toFixed(2);
 console.log(`${label}: ${secs}s errors=${JSON.stringify(errs)} typed=${JSON.stringify(typed)} `+Object.entries(lat).map(([k,v])=>`${k} p50=${pct(v,.5)} p95=${pct(v,.95)} max=${pct(v,1)}ms`).join(' | '));
 return {guests,errs,typed};
}
try{
 if(phase==='before'){
  await admin`insert into auth.users(id) values(${DJ})`;
  await admin`insert into public.events(id,dj_id,name,dj_name,room_code,cooldown_seconds) values(${EVENT},${DJ},'Capacity','DJ',${CODE},0)`;
  const seeded:R[]=[];for(let i=0;i<175;i++){const g=await call('join',{bootstrap:hex(),code:CODE,nickname:`Seed ${i}`});assert.equal(g.ok,true,`seed join ${i} ${g.error}`);seeded.push(g);}
  const songs:string[]=[];for(let i=0;i<149;i++){const g=seeded[i];const r=await call('request',{event_id:EVENT,token:g.token,idempotency_key:crypto.randomUUID(),source_platform:'itunes',source_song_id:`${900000+i}`,title:`Seed ${i}`,artist:'Seed'});assert.equal(r.ok,true,`seed request ${i} ${r.error}`);songs.push(r.request_id);}
  for(let i=0;i<140;i++)for(const s of [songs[(i+1)%149],songs[(i+7)%149]]){const r=await call('vote',{event_id:EVENT,token:seeded[i].token,request_id:s,value:i%3?1:-1});assert.equal(r.ok,true,`seed vote ${r.error}`);}
  await admin`create table public._cap_common as select ${songs[0]}::uuid id, ${seeded[0].principal_id}::uuid probe`;
  const ms=await snapshotMs(seeded[0].principal_id);console.log(`011 snapshot mean ${ms.toFixed(1)}ms (principals=${(await admin`select count(*)::int n from guest_runtime.app_principals`)[0].n})`);
  await admin`create table public._cap_ms as select ${ms}::float8 ms`;
  await freshFlow('011 fresh100',songs[0],'b');
  // Exact baseline for equivalence: every principal's aliases and every member/DJ snapshot.
  await admin`create table public._cap_aliases as select id, guest_runtime.aliases(id) a from guest_runtime.app_principals union all select gen_random_uuid(), guest_runtime.aliases(gen_random_uuid())`;
  await admin`create table public._cap_snap as select a.id actor,e.id event,guest_runtime.snapshot(a.id,e.id) s from guest_runtime.app_principals a cross join public.events e`;
  await admin`create table public._cap_defs as select md5(pg_get_functiondef('guest_runtime.aliases(uuid)'::regprocedure)) a, md5(pg_get_functiondef('guest_runtime.snapshot(uuid,uuid)'::regprocedure)) s`;
  console.log('RESULT before baseline captured',(await admin`select count(*)::int n from public._cap_snap where s is not null`)[0].n,'visible snapshots');
 }else{
  const [{id:common,probe}]=await admin`select * from public._cap_common`;
  ok((await admin`select count(*)::int n from public._cap_aliases b where b.a is distinct from guest_runtime.aliases(b.id)`)[0].n===0,'012 aliases identical for every principal and unknown actor');
  ok((await admin`select count(*)::int n from public._cap_aliases where cardinality(a)>1`)[0].n>0,'baseline includes merged alias sets');
  ok((await admin`select count(*)::int n from public._cap_snap b where b.s is distinct from guest_runtime.snapshot(b.actor,b.event)`)[0].n===0,'012 snapshot identical for every principal x event (incl. denied NULL)');
  const before=(await admin`select ms from public._cap_ms`)[0].ms,after=await snapshotMs(probe);
  console.log(`012 snapshot mean ${after.toFixed(1)}ms vs 011 ${before.toFixed(1)}ms`);
  ok(after*5<before,'snapshot at hosted-failure scale at least 5x faster');
  const plan=(await admin`explain (format json) select guest_runtime.aliases(${probe}::uuid)`);ok(!!plan,'aliases plannable');
  const songsBefore=(await admin`select count(*)::int n from public.song_requests where event_id=${EVENT}`)[0].n,upBefore=(await admin`select upvotes from public.song_requests where id=${common}`)[0].upvotes;
  const {guests,errs,typed}=await freshFlow('012 fresh100',common,'a');
  ok(Object.keys(errs).length===0&&Object.keys(typed).length===0,'no SQL timeouts/typed failures across 100 fresh guests x 4 ops');
  ok((await admin`select count(*)::int n from public.song_requests where event_id=${EVENT}`)[0].n===songsBefore+100,'exactly 100 new requests');
  ok((await admin`select upvotes from public.song_requests where id=${common}`)[0].upvotes===upBefore+100,'common upvotes exactly +100');
  ok((await admin`select upvotes,downvotes from public.song_requests where id=${common}`)[0].upvotes===(await admin`select count(*)::int n from public.votes where song_request_id=${common} and value=1`)[0].n,'counter equals vote rows');
  let coherent=0;for(const g of guests.slice(0,25)){const s=(await call('snapshot',g!.scope)).snapshot;const mine=s.songs.filter((x:R)=>x.is_mine);const c=s.songs.find((x:R)=>x.id===common);if(mine.length===1&&c.my_vote===1&&s.profile.id===g!.principal_id)coherent++;}
  ok(coherent===25,'final snapshots coherent: own request is_mine, my_vote=1, own profile');
  ok((await admin`select count(*)::int n from pg_locks where locktype='advisory'`)[0].n===0,'no leaked advisory locks');
  console.log(`RESULT ${n} capacity assertions passed`);
 }
}finally{await pool.end();await admin.end();}
