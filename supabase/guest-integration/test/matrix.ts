import postgres from 'postgres';
import assert from 'node:assert/strict';
const db=postgres({host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',max:105,onnotice:()=>{},connection:{statement_timeout:20000}});
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const bs=(n:number)=>n.toString(16).padStart(64,'0');
let checks=0;
function eq(a:unknown,b:unknown,label:string){assert.deepEqual(a,b,label);checks++;console.log('PASS',label);}
const service=<T>(f:(q:postgres.TransactionSql)=>Promise<T>)=>db.begin(async q=>{await q`set local role service_role`;await q`select set_config('request.jwt.claim.role','service_role',true)`;return f(q);});
const call=async(action:string,p:Record<string,unknown>)=>(await service(q=>q`select public.guest_event_api(${action},${q.json(p)}) r`))[0].r;
const claim=async(target:string,bootstrap:string)=>(await db.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${target},true)`;return q`select public.claim_guest_principal(${bootstrap}) r`;}))[0].r;
const authenticated=<T>(target:string,f:(q:postgres.TransactionSql)=>Promise<T>)=>db.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${target},true)`;return f(q);});
try{
 const dj=uid(1),target=uid(2),event=uid(100);
 await db`insert into auth.users(id) values(${dj}),(${target})`;
 await db`insert into public.events(id,dj_id,name,dj_name,room_code,cooldown_seconds) values(${event},${dj},'Local','DJ','LOCAL1',0)`;
 eq((await call('join',{bootstrap:bs(1),code:'LOCAL1',nickname:'Guest'})).error,'guest_disabled','disabled install fails closed');
 await db`update guest_runtime.installation set enabled=true`;
 const before=(await db`select count(*)::int n from auth.users`)[0].n;
 eq((await call('join',{bootstrap:bs(999),code:'BAD99',nickname:'Guest'})).status,404,'invalid code denied');
 eq((await db`select count(*)::int n from guest_runtime.app_principals where kind='guest'`)[0].n,0,'invalid code creates no principal');
 const joins=await Promise.all(Array.from({length:100},(_,i)=>call('join',{bootstrap:bs(i+1),code:'LOCAL1',nickname:'Guest'})));
 eq(joins.filter(r=>r.ok).length,100,'100 real concurrent fresh joins');
 eq((await db`select count(*)::int n from auth.users`)[0].n,before,'Auth rows unchanged');
 const g=joins[0],p={event_id:event,token:g.token};
 const retries=await Promise.all(Array.from({length:10},()=>call('join',{bootstrap:bs(1),code:'LOCAL1',nickname:'Guest'})));
 eq(new Set(retries.map(r=>r.principal_id)).size,1,'lost response retry same principal');eq(new Set(retries.map(r=>r.token)).size,1,'lost response retry same token');
 eq((await db`select count(*)::int n from public.points_transactions where user_id=${g.principal_id} and reason='Starter points'`)[0].n,1,'starter 15 once');
 eq((await db`select points from public.profiles where id=${g.principal_id}`)[0].points,16,'15 starter plus existing join award');
 eq((await call('resume',p)).session_id,g.session_id,'resume retains session');eq((await call('resume',p)).token,undefined,'resume never issues new token');
 eq((await call('snapshot',{event_id:event,token:bs(9999)})).status,401,'forged token denied');
 const key=uid(200),song={...p,idempotency_key:key,source_platform:'itunes',source_song_id:'1234',title:'Local track',artist:'Artist'};
 const rr=await Promise.all(Array.from({length:10},()=>call('request',song)));
 eq(new Set(rr.map(r=>r.request_id)).size,1,'parallel request idempotency');
 const rid=rr[0].request_id;assert.ok(rid);
 const votes=await Promise.all(joins.map(j=>call('vote',{event_id:event,token:j.token,request_id:rid,value:1})));
 eq(votes.filter(v=>v.ok).length,100,'100 concurrent authorized votes');
 eq((await db`select upvotes from public.song_requests where id=${rid}`)[0].upvotes,100,'exact delta counter');
 const snap=(await call('snapshot',p)).snapshot;eq(snap.songs[0].my_vote,1,'snapshot own desired vote');eq(snap.songs[0].upvotes,100,'coherent snapshot counter');eq(snap.songs[0].is_mine,true,'own request visibility');
 await db`update public.events set requests_status='paused' where id=${event}`;
 eq((await call('request',{...song,idempotency_key:uid(201),source_song_id:'5678'})).ok,false,'paused request blocked');eq((await call('vote',{...p,request_id:rid,value:-1})).ok,true,'paused voting preserved');
 await db`update public.events set requests_status='live' where id=${event}`;
 await db`insert into public.event_participants(event_id,user_id,nickname) values(${event},${target},'Target')`;
 await authenticated(target,q=>q`select public.set_song_vote(${rid},1)`);
 const immutable=(await db`select requested_by from public.song_requests where id=${rid}`)[0].requested_by;
 const sourceBalance=(await db`select points from public.profiles where id=${g.principal_id}`)[0].points;
 const targetBalance=(await db`select points from public.profiles where id=${target}`)[0].points;
 const claims=await Promise.all([claim(target,bs(1)),claim(target,bs(1))]);eq(claims.every(r=>r.ok),true,'parallel claim idempotent');
 eq((await db`select points from public.profiles where id=${g.principal_id}`)[0].points,0,'source balance zero');
 eq((await db`select points from public.profiles where id=${target}`)[0].points,targetBalance+sourceBalance-15,'target points preserved starter dedup exactly 15');
 eq((await db`select count(*)::int n from public.profiles p where p.id in(${g.principal_id},${target}) and p.points<>(select coalesce(sum(amount),0) from public.points_transactions t where t.user_id=p.id)`)[0].n,0,'both ledgers reconcile');
 eq((await db`select requested_by from public.song_requests where id=${rid}`)[0].requested_by,immutable,'request identity immutable after claim');
 eq((await db`select count(*)::int n from public.votes where song_request_id=${rid} and user_id in(${g.principal_id},${target})`)[0].n,1,'claim dedupes overlapping votes');
 eq((await call('snapshot',p)).status,401,'claim revokes source token');
 eq((await call('join',{bootstrap:bs(1),code:'LOCAL1',nickname:'Guest'})).status,401,'claim revokes bootstrap');
 await db`insert into public.event_banned_guests(event_id,user_id) values(${event},${g.principal_id})`;
 eq((await authenticated(target,q=>q`select public.is_event_member(${event}) m`))[0].m,false,'alias ban cannot be bypassed');
 await db`delete from public.event_banned_guests where user_id=${g.principal_id}`;
 // Alias financial caps preserve old identity and provider parameters, no provider calls.
 await db`insert into public.dj_payout_accounts(user_id,stripe_account_id,charges_enabled,payouts_enabled) values(${dj},'acct_local',true,true)`;
 await db`insert into public.purchase_consents(user_id,version) values(${target},'v2-tips-2026-06-12')`;
 await db`insert into public.dj_tips(user_id,dj_id,event_id,gross_amount_cents,platform_fee_cents,net_amount_cents,status) values(${g.principal_id},${dj},${event},5000,1500,3500,'pending')`;
 const reserved=await Promise.allSettled(Array.from({length:8},(_,i)=>service(q=>q`select (public.followup_reserve_tip(${target},${uid(500+i)},${event},5000,null,'https://fixture.invalid')).*`)));
 eq(reserved.filter(x=>x.status==='fulfilled').length,1,'alias financial cap accepts one 50 then blocks rest');
 eq((await db`select sum(gross_amount_cents)::int n from public.dj_tips where user_id=any(guest_runtime.aliases(${target}))`)[0].n,10000,'combined alias cap unchanged 100 dollars');
 eq((await db`select platform_fee_cents from public.dj_tips where user_id=${target}`)[0].platform_fee_cents,1500,'30 percent fee unchanged');
 const scope3={event_id:event,token:joins[2].token};
 eq((await call('join',{bootstrap:bs(2000),code:'LOCAL1',nickname:'s.h.i.t'})).status,400,'normalized profanity blocked in DB');
 eq((await call('profile',{...scope3,nickname:'aaaaa'})).status,400,'spam nickname blocked in DB');
 const extraEvents=[uid(101),uid(102),uid(103)];
 for(let i=0;i<3;i++)await db`insert into public.events(id,dj_id,name,dj_name,room_code,cooldown_seconds) values(${extraEvents[i]},${dj},'Extra','DJ',${'EXTRA'+i},0)`;
 for(let i=0;i<2;i++)eq((await call('join',{bootstrap:bs(3),code:'EXTRA'+i,nickname:'Guest'})).ok,true,'guest joins event '+(i+2));
 eq((await call('join',{bootstrap:bs(3),code:'EXTRA2',nickname:'Guest'})).ok,false,'fourth distinct event blocked');
 eq((await call('snapshot',{event_id:extraEvents[0],token:joins[2].token})).status,401,'cross-event token denied');
 await db`delete from guest_runtime.operations where principal_id=${joins[3].principal_id}`;
 const burst=await Promise.all(Array.from({length:40},()=>call('vote',{event_id:event,token:joins[3].token,request_id:rid,value:1})));
 eq(burst.filter(r=>r.ok).length,30,'mutation burst allows exactly 30');
 eq(burst.filter(r=>r.status===429&&r.error==='guest_rate_limited').length,10,'mutation burst returns exactly 10 typed 429');
 eq((await call('snapshot',{event_id:event,token:joins[3].token})).ok,true,'read budget independent of mutation budget');
 const aliasTip=(await db`select id from public.dj_tips where user_id=${g.principal_id}`)[0].id;
 const evidence={event_id:'evt_local_paid',event_type:'payment_intent.succeeded',tip_id:aliasTip,kind:'paid',payment_intent:'pi_local',amount_cents:5000,currency:'usd',livemode:false};
 await service(q=>q`select public.followup_apply_financial_event(${q.json(evidence)})`);
 eq((await db`select user_id from public.dj_tips where id=${aliasTip}`)[0].user_id,g.principal_id,'alias settlement preserves immutable financial owner');
 let mismatch=false;try{await service(q=>q`select public.followup_apply_financial_event(${q.json({...evidence,event_id:'evt_wrong',payment_intent:'pi_wrong'})})`);}catch{mismatch=true;}
 eq(mismatch,true,'provider identity mismatch refused without provider call');
 await db`update public.events set requests_status='ended' where id=${event}`;
 eq((await call('vote',{...scope3,request_id:rid,value:1})).status,401,'ended mutation credential refused');
 eq((await call('snapshot',scope3)).snapshot.event.requests_status,'ended','ended authoritative state readable');
 // Contract mismatch every noncontract op.
 await db`update guest_runtime.installation set contract='wrong'`;
 eq((await call('snapshot',{event_id:event,token:joins[1].token})).error,'contract_mismatch','contract mismatch fails closed');await db`update guest_runtime.installation set contract='guest-integration-v1'`;
 await db`update guest_runtime.sessions set expires_at=now()-interval '1 second' where principal_id=${joins[1].principal_id}`;
 eq((await call('snapshot',{event_id:event,token:joins[1].token})).status,401,'expired session denied');
 eq((await db`select has_schema_privilege('anon','guest_runtime','usage') b`)[0].b,false,'private schema inaccessible');
 eq((await db`select has_function_privilege('authenticated','public.guest_event_api(text,jsonb)','execute') b`)[0].b,false,'guest API service only');
 // Protected FK lifecycle: no fake Auth identities, no silent unchecked UUIDs.
 let rejected=false;
 try{await db`insert into public.profiles(id,auth_user_id,nickname) values(${uid(700)},${uid(700)},'Missing')`;}catch{rejected=true;}
 eq(rejected,true,'missing Auth row rejected by real profile FK');
 rejected=false;try{await db`update public.profiles set auth_user_id=null where id=${target}`;}catch{rejected=true;}
 eq(rejected,true,'registered link cannot be cleared');
 const disposable=uid(701);
 await db`insert into auth.users(id) values(${disposable})`;
 eq((await db`select auth_user_id from public.profiles where id=${disposable}`)[0].auth_user_id,disposable,'bootstrap creates protected profile first');
 eq((await db`select auth_user_id from guest_runtime.app_principals where id=${disposable}`)[0].auth_user_id,disposable,'bootstrap principal references registered profile');
 await db`delete from auth.users where id=${disposable}`;
 eq((await db`select count(*)::int n from public.profiles where id=${disposable}`)[0].n,0,'Auth deletion cascades profile');
 eq((await db`select count(*)::int n from guest_runtime.app_principals where id=${disposable}`)[0].n,0,'Auth deletion cascades principal');
 await db`delete from public.profiles where id=${joins[90].principal_id}`;
 eq((await db`select count(*)::int n from guest_runtime.sessions where principal_id=${joins[90].principal_id}`)[0].n,0,'unclaimed guest profile deletion removes credentials');
 eq((await db`select count(*)::int n from guest_runtime.app_principals where id=${joins[90].principal_id}`)[0].n,0,'guest profile deletion cascades principal');
 rejected=false;try{await db`delete from auth.users where id=${target}`;}catch{rejected=true;}
 eq(rejected,true,'claimed target Auth deletion restricted atomically by alias history');
 rejected=false;try{await db`delete from public.profiles where id=${g.principal_id}`;}catch{rejected=true;}
 eq(rejected,true,'claimed source profile deletion restricted by claim history');
 eq((await db`select count(*)::int n from auth.users where id=${target}`)[0].n,1,'failed claimed deletion retains real Auth identity');
 // Deterministic interleaving: exclusive claim gate holds writers before tuples.
 await db`update public.events set requests_status='live' where id=${event}`;
 const contender=joins[80];
 const contenderSong=await call('request',{event_id:event,token:contender.token,idempotency_key:uid(780),source_platform:'itunes',source_song_id:'780',title:'Concurrent',artist:'Artist'});
 assert.ok(contenderSong.request_id);
 const pendingTip=uid(781);
 await db`insert into public.dj_tips(id,user_id,dj_id,event_id,gross_amount_cents,platform_fee_cents,net_amount_cents,status) values(${pendingTip},${contender.principal_id},${dj},${event},100,30,70,'pending')`;
 let release:()=>void=()=>{};let acquired:()=>void=()=>{};
 const ready=new Promise<void>(r=>{acquired=r;});const hold=new Promise<void>(r=>{release=r;});
 const blocker=db.begin(async q=>{await q`select pg_advisory_xact_lock(8713201,1)`;acquired();await hold;});await ready;
 const award=db.begin(q=>q`select public.award_points(${contender.principal_id},${event},2,'earned','Concurrent award')`);
 const playing=authenticated(dj,q=>q`select public.dj_transition_request(${event},${contenderSong.request_id},'playing')`);
 const profile=authenticated(target,q=>q`select public.update_my_profile('Target',true)`);
 const ban=db.begin(q=>q`insert into public.event_banned_guests(event_id,user_id) values(${event},${contender.principal_id})`);
 const paid=service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:'evt_concurrent',event_type:'payment_intent.succeeded',tip_id:pendingTip,kind:'paid',payment_intent:'pi_concurrent',amount_cents:100,currency:'usd',livemode:false})})`);
 const merging=claim(target,bs(81));
 // Poll actual lock wait inventory; timing alone never constitutes barrier evidence.
 let waiting=0;for(let i=0;i<200;i++){waiting=(await db`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'`)[0].n;if(waiting>=6)break;await new Promise(r=>setTimeout(r,10));}
 release();await blocker;
 await Promise.all([award,playing,profile,ban,paid,merging]);
 eq(waiting>=6,true,'DJ ban profile award settlement and claim wait at exclusion gate before tuples');
 eq((await db`select count(*)::int n from public.song_requests where event_id=${event} and status='playing'`)[0].n,1,'DJ claim interleaving keeps one playing request');
 eq((await db`select count(*)::int n from public.profiles p where id in(${contender.principal_id},${target}) and points<>(select coalesce(sum(amount),0) from public.points_transactions t where t.user_id=p.id)`)[0].n,0,'concurrent award and claim reconcile both ledgers');
 eq((await db`select user_id from public.dj_tips where id=${pendingTip}`)[0].user_id,contender.principal_id,'claim settlement leaves immutable owner');
 eq((await db`select status from public.dj_tips where id=${pendingTip}`)[0].status,'succeeded','parallel financial settlement succeeds');
 eq((await authenticated(target,q=>q`select public.is_event_member(${event}) m`))[0].m,false,'concurrent source ban remains effective after claim');
 console.log(`RESULT ${checks} local database assertions passed`);
}finally{await db.end();}
