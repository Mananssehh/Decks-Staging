import postgres from 'postgres';
import assert from 'node:assert/strict';
const db=postgres({host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',max:24,onnotice:()=>{}});
let checks=0;
function check(label:string,value:unknown,expected:unknown){assert.deepEqual(value,expected,label);checks++;console.log('PASS',label);}
const uuid=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=uuid(1),guest=uuid(2),other=uuid(3),eid=uuid(1000);
async function asUser<T>(id:string,fn:(q:postgres.TransactionSql)=>Promise<T>){return db.begin(async q=>{await q`set local role authenticated`;await q`select set_config('request.jwt.claim.sub',${id},true)`;return fn(q);});}
async function denied(label:string,fn:()=>Promise<unknown>){try{await fn();throw new Error(label+' unexpectedly accepted');}catch(e){assert.ok(e instanceof postgres.PostgresError,label);checks++;console.log('PASS',label);}}
async function request(id:string,sid:string,event=eid){return asUser(id,q=>q`select * from public.request_song(${event},'itunes',${sid},${'Track '+sid},'Artist')`);}
try {
 await db`insert into auth.users(id) values(${owner}),(${guest}),(${other})`;
 check('bootstrap starter balance',(await db`select points from public.profiles where id=${guest}`)[0].points,15);
 check('bootstrap one starter ledger',(await db`select count(*)::int n from public.points_transactions where user_id=${guest} and reason='Starter points'`)[0].n,1);
 await db`insert into public.user_roles(user_id,role) values(${owner},'dj')`;
 await db`insert into public.events(id,dj_id,name,dj_name,room_code,cooldown_seconds) values(${eid},${owner},'Fixture','DJ','ROOM01',30)`;
 const join=()=>asUser(guest,q=>q`select public.join_event_by_code('ROOM01','SameNick') j`);
 check('first join',(await join())[0].j.ok,true);
 await Promise.all(Array.from({length:12},join));
 check('returning retry keeps one admission',(await db`select count(*)::int n from public.repair_admission_log where user_id=${guest} and admitted`)[0].n,1);
 check('returning retries do not award points',(await db`select points from public.profiles where id=${guest}`)[0].points,16);
 await denied('direct participant INSERT denied',()=>asUser(other,q=>q`insert into public.event_participants(event_id,user_id,nickname) values(${eid},${other},'Bypass')`));
 await asUser(other,q=>q`select public.join_event_by_code('ROOM01',null)`);
 const created=(await request(guest,'101'))[0];check('request positive',created.outcome,'created');const song=created.request_id;
 check('new request cooldown',(await request(guest,'102'))[0].outcome,'cooldown');
 check('support bypasses cooldown',(await request(other,'101'))[0].outcome,'supported_existing');
 await denied('guest counters UPDATE denied',()=>asUser(guest,q=>q`update public.song_requests set upvotes=999 where id=${song}`));
 await denied('guest queue UPDATE denied',()=>asUser(guest,q=>q`update public.song_requests set queue_position=1 where id=${song}`));
 await denied('guest pending DELETE denied',()=>asUser(guest,q=>q`delete from public.song_requests where id=${song}`));
 await denied('guest points UPDATE denied',()=>asUser(guest,q=>q`update public.profiles set points=999 where id=${guest}`));
 await denied('guest profile INSERT denied',()=>asUser(guest,q=>q`insert into public.profiles(id,nickname,points) values(${uuid(999)},'Fake',999)`));
 await denied('internal award denied',()=>asUser(guest,q=>q`select public.award_points(${guest},${eid},100,'earned')`));
 await denied('boost paused',()=>asUser(guest,q=>q`select public.boost_request(${song},1)`));
 await denied('direct vote UPDATE denied',()=>asUser(guest,q=>q`update public.votes set value=-1 where song_request_id=${song}`));
 await denied('vote identity immutable for service too',()=>db`update public.votes set song_request_id=${uuid(999)} where song_request_id=${song}`);
 await db`update public.events set requests_status='paused' where id=${eid}`;
 await asUser(other,q=>q`select public.set_song_vote(${song},-1)`);checks++;console.log('PASS paused vote allowed');
 check('paused request denied',(await request(other,'103'))[0].outcome,'unavailable');
 await db`update public.events set requests_status='live' where id=${eid}`;
 // Concurrent desired-state voting versus duplicate-support request: both event-first, no tuple inversion.
 await Promise.all(Array.from({length:30},(_,i)=>i%2?asUser(other,q=>q`select public.set_song_vote(${song},${i%3?1:null})`):request(other,'101')));
 const totals=await db`select sr.upvotes,sr.downvotes,(select count(*)::int from public.votes where song_request_id=sr.id and value=1) u,(select count(*)::int from public.votes where song_request_id=sr.id and value=-1) d from public.song_requests sr where id=${song}`;
 check('concurrent vote/request totals', [totals[0].upvotes,totals[0].downvotes],[totals[0].u,totals[0].d]);
 await db`insert into public.event_banned_guests(event_id,user_id) values(${eid},${other})`;
 await denied('banned vote denied',()=>asUser(other,q=>q`select public.set_song_vote(${song},1)`));
 check('banned request denied',(await request(other,'104'))[0].outcome,'unavailable');
 check('banned join generic',(await asUser(other,q=>q`select public.join_event_by_code('ROOM01',null) j`))[0].j.reason,'unavailable');
 await db`delete from public.event_banned_guests where event_id=${eid}`;
 await denied('nonowner transition denied',()=>asUser(other,q=>q`select public.dj_transition_request(${eid},${song},'playing')`));
 await asUser(owner,q=>q`select public.dj_transition_request(${eid},${song},'approved')`);checks++;console.log('PASS owner approval');
 await asUser(owner,q=>q`select public.dj_transition_request(${eid},${song},'playing')`);
 check('play mirror linked',(await db`select now_playing_request_id from public.now_playing where event_id=${eid}`)[0].now_playing_request_id,song);
 await db`update public.events set cooldown_seconds=0 where id=${eid}`;
 const s2=(await request(guest,'105'))[0].request_id;
 await Promise.all([asUser(owner,q=>q`select public.dj_transition_request(${eid},${song},'playing')`),asUser(owner,q=>q`select public.dj_transition_request(${eid},${s2},'playing')`)]);
 check('parallel DJ only one playing',(await db`select count(*)::int n from public.song_requests where event_id=${eid} and status='playing'`)[0].n,1);
 check('old played timestamp preserved',(await db`select played_at is not null b from public.song_requests where id=${song}`)[0].b,true);
 // Force mirror failure and prove transaction restores both previous and selected rows.
 await db`create function public.fixture_fail_mirror() returns trigger language plpgsql as $$ begin raise exception 'fixture mirror failure'; end $$`;
 await db`create trigger fixture_fail before insert or update on public.now_playing for each row execute function public.fixture_fail_mirror()`;
 const s3=(await request(guest,'106'))[0].request_id;
 await denied('mirror failure propagated',()=>asUser(owner,q=>q`select public.dj_transition_request(${eid},${s3},'playing')`));
 check('mirror failure rolls back selected',(await db`select status from public.song_requests where id=${s3}`)[0].status,'pending');
 check('mirror failure retains previous playing',(await db`select status from public.song_requests where id=${s2}`)[0].status,'playing');
 await db`drop trigger fixture_fail on public.now_playing`;await db`drop function public.fixture_fail_mirror()`;
 const points=(await db`select points from public.profiles where id=${guest}`)[0].points;
 await asUser(guest,q=>q`select public.remove_my_song_request(${s3})`);
 check('removal refunds request award',(await db`select points from public.profiles where id=${guest}`)[0].points,points-1);
 await denied('repeat removal no refund',()=>asUser(guest,q=>q`select public.remove_my_song_request(${s3})`));
 await db`update public.events set cooldown_seconds=30 where id=${eid}`;
 check('removed row retains cooldown',(await request(guest,'107'))[0].outcome,'cooldown');
 await db`update public.events set cooldown_seconds=0,allow_explicit=false where id=${eid}`;
 check('explicit positive enforcement',(await asUser(guest,q=>q`select * from public.request_song(${eid},'itunes','108','Explicit','Artist',null,null,null,null,true)`))[0].outcome,'explicit_not_allowed');
 await db`insert into public.event_blocklist(event_id,kind,value) values(${eid},'artist','Artist')`;
 check('blocklist enforced',(await request(guest,'109'))[0].outcome,'blocked');await db`delete from public.event_blocklist where event_id=${eid}`;
 await db`update public.events set requests_status='ended' where id=${eid}`;
 await denied('ended vote denied',()=>asUser(guest,q=>q`select public.set_song_vote(${s2},1)`));
 check('ended request denied',(await request(guest,'110'))[0].outcome,'unavailable');
 await db`update public.events set requests_status='live' where id=${eid}`;
 check('first ingest token usable',typeof (await asUser(owner,q=>q`select public.get_ingest_token(${eid}) t`))[0].t,'string');
 await db`insert into public.bridge_pairing_codes(code,event_id,created_by,expires_at) values('123456',${eid},${owner},now()+interval '5 minutes')`;
 const claims=await Promise.all(Array.from({length:12},(_,i)=>db.begin(async q=>{await q`set local role service_role`;return q`select public.repair_claim_bridge_code('123456',${'fixture-'+i}) j`;})));
 check('atomic bridge claim exactly one',claims.filter(r=>r[0].j.ok).length,1);
 await denied('client bridge claim denied',()=>asUser(guest,q=>q`select public.repair_claim_bridge_code('123456','same-ip')`));
 const fails=await Promise.all(Array.from({length:20},()=>db.begin(async q=>{await q`set local role service_role`;return q`select public.repair_claim_bridge_code('000000','fail-ip') j`;})));
 check('bridge failed attempt cap exact',(await db`select count(*)::int n from public.bridge_pair_attempts where ip='fail-ip'`)[0].n,10);
 check('bridge fail-closed limit',fails.filter(r=>r[0].j.reason==='rate_limited').length,10);
 // At least 100 prepared identities + retries, shared venue has no join IP key.
 await db`insert into auth.users(id) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from generate_series(100,420) i`;
 const crowd=await Promise.all(Array.from({length:100},(_,i)=>asUser(uuid(100+i),q=>q`select public.join_event_by_code('ROOM01',null) j`)));
 check('100 prepared identities all admitted',crowd.filter(r=>r[0].j.ok).length,100);
 await Promise.all(Array.from({length:100},(_,i)=>asUser(uuid(100+i),q=>q`select public.join_event_by_code('ROOM01',null)`)));
 await db`insert into public.repair_admission_settings(event_budget) values(100)`;
 check('event budget refuses new identity',(await asUser(uuid(200),q=>q`select public.join_event_by_code('ROOM01',null) j`))[0].j.ok,false);
 const attempts=()=>asUser(uuid(201),q=>q`select public.join_event_by_code('INVALID',null)`);
 await Promise.all(Array.from({length:20},attempts));
 check('guest concurrent attempt cap exact',(await db`select count(*)::int n from public.repair_admission_log where user_id=${uuid(201)}`)[0].n,10);
 await db`delete from public.repair_admission_settings`;
 const anon=uuid(300);await db`update auth.users set is_anonymous=true where id=${anon}`;
 for(let i=1;i<=4;i++){await db`insert into public.events(dj_id,name,dj_name,room_code) values(${owner},'Guest limit','DJ',${'LIMIT'+i})`;const r=await asUser(anon,q=>q`select public.join_event_by_code(${'LIMIT'+i},null) j`);check('anonymous admission '+i,r[0].j.ok,i<4);}
 await db`insert into public.repair_admission_log(user_id,created_at) values(${guest},now()-interval '2 days')`;
 await db`select public.repair_prune_limiter_logs()`;
 check('limiter retention',(await db`select count(*)::int n from public.repair_admission_log where created_at<now()-interval '24 hours'`)[0].n,0);
 const acl=await db`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('award_points','enqueue_email','read_email_batch','delete_email','move_to_dlq','boost_request') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`;
 check('all six sensitive ACLs closed',acl.length,0);
 check('staging email no-op',(await db`select prosrc like '%BEGIN RETURN; END;%' b from pg_proc where proname='email_queue_dispatch'`)[0].b,true);
 console.log(`RESULT: ${checks} checks passed; concurrent groups completed without deadlocks`);
} finally {await db.end();}
