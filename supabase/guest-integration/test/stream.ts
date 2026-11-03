import postgres from 'postgres';
import assert from 'node:assert/strict';
const db=postgres({host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',max:105,onnotice:()=>{}});
let checks=0;function eq(a:unknown,b:unknown,label:string){assert.deepEqual(a,b,label);checks++;console.log('PASS',label);}
const service=<T>(f:(q:postgres.TransactionSql)=>Promise<T>)=>db.begin(async q=>{await q`set local role service_role`;await q`select set_config('request.jwt.claim.role','service_role',true)`;return f(q);});
const call=async(a:string,p:Record<string,unknown>)=>(await service(q=>q`select public.guest_event_api(${a},${q.json(p)}) r`))[0].r;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const auth=async(e:string,t:string)=>(await service(q=>q`select public.guest_stream_auth(${e},${t}) r`))[0].r;
const poll=async(e:string,s:string[])=>(await service(q=>q`select public.guest_stream_poll(${e},${s}::uuid[]) r`))[0].r;
const rev=async(e:string)=>BigInt((await db`select revision::text r from guest_runtime.event_revisions where event_id=${e}`)[0].r);
try{
 const dj=id(9000),event=id(9001),second=id(9002);await db`insert into auth.users(id) values(${dj})`;
 await db`insert into public.events(id,dj_id,name,dj_name,room_code,cooldown_seconds) values(${event},${dj},'Stream','DJ','STREAM1',0),(${second},${dj},'Second','DJ','STREAM2',0)`;
 const bootstrap='f'.repeat(64),join=await call('join',{code:'STREAM1',bootstrap,nickname:'Stream'});
 eq((await auth(event,join.token)).status,503,'stream installed disabled');
 await db`update guest_runtime.stream_installation set enabled=true`;
 const trusted=await auth(event,join.token);eq(trusted.session_id,join.session_id,'token establishes trusted session');eq(trusted.actor_id,join.principal_id,'trusted actor from token');
 eq((await auth(second,join.token)).status,401,'stream cross-event token rejected');eq((await auth(event,id(9003))).status,401,'stream UUID alone rejected');
 eq((await poll(event,[join.session_id])).valid_session_ids,[join.session_id],'authorized batch session retained');
 eq((await poll(second,[join.session_id])).valid_session_ids,[],'batch scope cannot cross events');eq((await poll(event,Array.from({length:257},()=>join.session_id))).status,400,'poll batch bound 256');
 const before=await rev(event);const request=await call('request',{event_id:event,token:join.token,idempotency_key:id(9003),source_platform:'itunes',source_song_id:'9003',title:'Stream song',artist:'Artist',album:'Safe album',duration_ms:123000});
 eq(await rev(event)>before,true,'request commits transactional revision');
 const snap=(await call('snapshot',{event_id:event,token:join.token})).snapshot;eq(snap.revision,(await rev(event)).toString(),'snapshot and revision coherent');eq(snap.songs[0].album,'Safe album','snapshot overlay keeps expanded DTO');eq(snap.songs[0].duration_ms,123000,'snapshot overlay keeps duration');
 const unchanged=await rev(event);await db`update public.song_requests set title=title where id=${request.request_id}`;eq(await rev(event),unchanged,'no-op song update does not bump');
 await db`update public.song_requests set title='Changed' where id=${request.request_id}`;eq(await rev(event)>unchanged,true,'actual song update bumps');
 const transactional=await rev(event);try{await db.begin(async q=>{await q`update public.song_requests set title='Rollback' where id=${request.request_id}`;throw Error('rollback');});}catch{/* intentional */}eq(await rev(event),transactional,'rolled-back revision not visible');
 await db`insert into public.now_playing(event_id,title,source) values(${event},'Stream song','manual')`;const np=await rev(event);await db`update public.now_playing set title='New track' where event_id=${event}`;eq(await rev(event)>np,true,'now-playing change bumps');
 const voteBefore=await rev(event);await call('vote',{event_id:event,token:join.token,request_id:request.request_id,value:1});eq(await rev(event)>voteBefore,true,'vote counter change bumps via songs');
 await db`insert into public.event_banned_guests(event_id,user_id) values(${event},${join.principal_id})`;
 eq((await poll(event,[join.session_id])).valid_session_ids,[],'ban excluded with new revision in same poll');eq((await auth(event,join.token)).status,401,'banned auth rejected');
 await db`delete from public.event_banned_guests where event_id=${event}`;eq((await poll(event,[join.session_id])).valid_session_ids,[join.session_id],'unban authorized membership resumes');
 const expiredBefore=await rev(event);await db`update guest_runtime.sessions set expires_at=now()-interval '1 second' where id=${join.session_id}`;eq(await rev(event)>expiredBefore,true,'session expiry mutation bumps');eq((await poll(event,[join.session_id])).valid_session_ids,[],'expired batch session denied');eq((await auth(event,join.token)).status,401,'expired auth rejected');
 await db`update guest_runtime.sessions set expires_at=now()+interval '1 hour' where id=${join.session_id}`;
 const target=id(9004);await db`insert into auth.users(id) values(${target})`;
 const claimBefore=await rev(event);await db.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${target},true)`;await q`select public.claim_guest_principal(${bootstrap})`;});eq(await rev(event)>claimBefore,true,'claim revocation bumps event');eq((await poll(event,[join.session_id])).valid_session_ids,[],'claimed alias session never valid');
 // Poll uses MVCC read, does not wait for an event exclusive tuple lock.
 let release:()=>void=()=>{};let ready:()=>void=()=>{};const hold=new Promise<void>(r=>{release=r;});const started=new Promise<void>(r=>{ready=r;});const lock=db.begin(async q=>{await q`select id from public.events where id=${event} for update`;ready();await hold;});await started;
 try{const r=await poll(event,[join.session_id]);eq(r.ok,true,'poll completes under exclusive event row lock without upgrading');}finally{release();await lock;}
 await db`update public.events set requests_status='ended' where id=${event}`;eq((await poll(event,[join.session_id])).lifecycle,'ended','ended lifecycle hint reads authoritatively');
 await db`update guest_runtime.installation set contract='wrong'`;eq((await poll(event,[join.session_id])).status,503,'poll contract mismatch service unavailable');await db`update guest_runtime.installation set contract='guest-integration-v1'`;
 for(const role of ['anon','authenticated']){eq((await db`select has_function_privilege(${role},'public.guest_stream_poll(uuid,uuid[])','execute') b`)[0].b,false,role+' poll closed');eq((await db`select has_function_privilege(${role},'public.guest_stream_auth(uuid,text)','execute') b`)[0].b,false,role+' auth closed');}
 eq((await db`select relrowsecurity from pg_class where oid='guest_runtime.event_revisions'::regclass`)[0].relrowsecurity,true,'revision private RLS');eq((await db`select has_table_privilege('service_role','guest_runtime.event_revisions','select') b`)[0].b,false,'service table reads closed');
 await db`delete from public.now_playing where event_id=${event}`;await db`delete from public.song_requests where id=${request.request_id}`;
 await db`delete from public.events where id=${second}`;eq((await poll(second,[join.session_id])).lifecycle,'deleted','event deletion cascade safely reports deleted');eq((await db`select count(*)::int n from guest_runtime.event_revisions where event_id=${second}`)[0].n,0,'event cascade removes revision without trigger resurrection');
 console.log(`RESULT ${checks} stream SQL assertions passed`);
}finally{await db.end();}