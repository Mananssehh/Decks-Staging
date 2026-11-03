import postgres from 'postgres';
import assert from 'node:assert/strict';
const db=postgres({host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',onnotice:()=>{}});
let n=0;function eq(a:unknown,b:unknown,label:string){assert.deepEqual(a,b,label);n++;console.log('PASS',label);}
const service=<T>(f:(q:postgres.TransactionSql)=>Promise<T>)=>db.begin(async q=>{await q`set local role service_role`;await q`select set_config('request.jwt.claim.role','service_role',true)`;return f(q);});
const call=async(a:string,p:Record<string,unknown>)=>(await service(q=>q`select public.guest_event_api(${a},${q.json(p)}) r`))[0].r;
const id='00000000-0000-4000-8000-000000009101',event='00000000-0000-4000-8000-000000009102';
try{
 await db`insert into auth.users(id) values(${id})`;await db`insert into public.events(id,dj_id,name,dj_name,room_code,cooldown_seconds) values(${event},${id},'Application','DJ','APPTEST',0)`;
 const bootstrap='e'.repeat(64),g=await call('join',{bootstrap,code:'APPTEST',nickname:'Original'}),scope={event_id:event,token:g.token};
 await call('join',{bootstrap,code:'APPTEST',nickname:'Updated'});eq((await db`select nickname,points from public.profiles where id=${g.principal_id}`)[0],{nickname:'Updated',points:16},'returning bootstrap synchronizes profile nickname no extra points');
 const manual={...scope,idempotency_key:crypto.randomUUID(),source_platform:'manual',source_song_id:'',title:'Manual Song',artist:'Manual Artist',explicit:false};
 const r=await call('request',manual);eq(r.outcome,'created','manual creates via shared common kernel');eq((await call('request',{...manual,idempotency_key:crypto.randomUUID()})).outcome,'already_supported','manual duplicate supports active request');
 eq((await db`select count(*)::int n from public.points_transactions where user_id=${g.principal_id} and song_request_id=${r.request_id} and amount=1`)[0].n,1,'manual one point award once');
 eq((await call('request',{...manual,idempotency_key:crypto.randomUUID(),title:'Unsafe',external_url:'javascript:alert(1)'})).error,'invalid_track','unsafe URL rejected in common guest kernel');
 const ar=await db.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${id},true)`;return q`select * from public.request_song(${event},'manual',null,'Unsafe auth','Artist',null,null,null,null,false,'data:text/html,evil')`;});eq(ar[0].outcome,'invalid_track','unsafe URL rejected same authenticated kernel');
 const provider=await call('request',{...scope,idempotency_key:crypto.randomUUID(),source_platform:'itunes',source_song_id:'12399',title:'Provider Match',artist:'Same Artist'});
 eq((await call('request',{...manual,idempotency_key:crypto.randomUUID(),title:'Provider Match',artist:'Same Artist'})).request_id,provider.request_id,'manual title artist matches existing provider request');
 const resolver=(await service(q=>q`select public.guest_application_actor(${event},${g.token},'consent') r`))[0].r;eq(resolver.consent_version,'v2-tips-2026-06-12','consent server current version');
 eq((await db`select count(*)::int n from public.purchase_consents where user_id=${g.principal_id} and version='v2-tips-2026-06-12'`)[0].n,1,'guest consent evidence recorded once');
 const pub=(await service(q=>q`select public.guest_event_public_profile(${event},${g.token},${g.principal_id}) r`))[0].r;eq(pub.profile,{found:false,is_public:false},'private guest profile no disclosure');
 eq((await service(q=>q`select public.application_own_ledger(${event},${g.token},0,'all') r`))[0].r.rows.length,4,'guest ledger reads starter, join and two request awards');
 await db`update public.song_requests set external_url='javascript:evil',preview_url='data:evil',album_art='javascript:evil' where id=${r.request_id}`;
 const snap=(await call('snapshot',scope)).snapshot;const row=snap.songs.find((s:{id:string})=>s.id===r.request_id);eq([row.external_url,row.preview_url,row.album_art,row.profile_linkable],[null,null,null,false],'snapshot sanitizes stored unsafe links and hides private profile links');
 await service(q=>q`select public.prepare_registered_profile_deletion(${id})`);await db`delete from auth.users where id=${id}`;
 let refused=false;try{await db.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${id},true)`;await q`select public.ensure_profile('Stale')`;});}catch{refused=true;}eq(refused,true,'stale deleted Auth JWT cannot recreate guest identity');
 console.log(`RESULT ${n} application SQL assertions passed`);
}finally{await db.end();}