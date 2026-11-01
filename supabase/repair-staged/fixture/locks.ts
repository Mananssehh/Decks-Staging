import postgres from 'postgres';
import assert from 'node:assert/strict';
const opts={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',connection:{statement_timeout:10000,lock_timeout:5000},onnotice:()=>{}};
const db=postgres(opts);const a=postgres({...opts,max:1});const b=postgres({...opts,max:1});
const eid='00000000-0000-0000-0000-000000001000',user='00000000-0000-0000-0000-000000000002';
let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});let locked:()=>void=()=>{};const acquired=new Promise<void>(r=>{locked=r;});
try {
 const [song]=await db`insert into public.song_requests(event_id,requested_by,title,artist,source_platform,source_song_id) values(${eid},${user},'Lock fixture','Artist','itunes','999999') returning id`;
 assert.ok(song);
 const holder=a.begin(async q=>{await q`select id from public.events where id=${eid} for update`;locked();await gate;await q`update public.events set requests_status='ended' where id=${eid}`;});
 await acquired;
 const waiter=b.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${user},true)`;await q`select public.set_song_vote(${song.id},1)`;}).then(()=>({ok:true}),error=>({ok:false,error}));
 let observed=false;
 for(let i=0;i<100;i++){
  const [state]=await db`select exists(select 1 from pg_stat_activity where datname='decks_repair' and wait_event_type='Lock' and query like '%set_song_vote%') b`;
  if(state.b){observed=true;break;}await new Promise(r=>setTimeout(r,10));
 }
 assert.equal(observed,true,'vote waits on event mutex before tuple mutation');
 release();await holder;const result=await waiter;assert.equal(result.ok,false,'ended event rechecked after lock acquisition');
 if('error' in result)assert.equal(result.error.code,'42501');
 console.log('PASS deterministic event lock barrier and ended-state recheck');
 await db`update public.events set requests_status='live' where id=${eid}`;
} finally {release();await Promise.all([db.end(),a.end(),b.end()]);}
