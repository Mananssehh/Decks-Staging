import postgres from 'postgres';
import assert from 'node:assert/strict';
const db=postgres({host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'decks_repair',max:24,onnotice:()=>{},connection:{statement_timeout:10000}});
let count=0;
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const user=uuid(1),dj=uuid(2),event=uuid(100),otherEvent=uuid(101);
const check=(label:string,value:unknown,want:unknown)=>{assert.deepEqual(value,want,label);count++;console.log('PASS',label);};
async function denied(label:string,fn:()=>Promise<unknown>){try{await fn();throw Error('unexpected accept');}catch(e){assert.ok(e instanceof postgres.PostgresError,label);count++;console.log('PASS',label);}}
const service=<T>(fn:(q:postgres.TransactionSql)=>Promise<T>)=>db.begin(async q=>{await q`set local role service_role`;await q`select set_config('request.jwt.claim.role','service_role',true)`;return fn(q);});
const reserve=(key:string,amount=5000,e=event)=>service(q=>q`select (public.followup_reserve_tip(${user},${key},${e},${amount},null,'https://fixture.invalid')).*`);
try {
 await db`insert into public.profiles(id,nickname) values(${user},'Guest'),(${dj},'DJ')`;
 await db`insert into public.events(id,dj_id,name,dj_name,room_code) values(${event},${dj},'Fixture','DJ','PAY001'),(${otherEvent},${dj},'Other','DJ','PAY002')`;
 await db`insert into public.event_participants(event_id,user_id,nickname) values(${event},${user},'Guest'),(${otherEvent},${user},'Guest')`;
 await db`insert into public.dj_payout_accounts(user_id,stripe_account_id,charges_enabled,payouts_enabled) values(${dj},'acct_fake',true,true)`;
 await db`insert into public.purchase_consents(user_id,version) values(${user},'obsolete')`;
 await denied('exact current consent required',()=>reserve(uuid(10)));
 await db`insert into public.purchase_consents(user_id,version) values(${user},'v2-tips-2026-06-12')`;
 for(const amount of [99,5001]) await denied('single-tip boundary '+amount,()=>reserve(uuid(amount),amount));
 const retries=await Promise.all(Array.from({length:20},()=>reserve(uuid(10))));
 check('concurrent same logical key creates one reservation',new Set(retries.map(r=>r[0].id)).size,1);
 check('one tip row precedes external provider call',(await db`select count(*)::int n from public.dj_tips`)[0].n,1);
 check('30 percent fee unchanged',[retries[0][0].checkout_parameters.fee], [1500]);
 await denied('same key different payload rejected',()=>reserve(uuid(10),100));
 const contenders=await Promise.allSettled(Array.from({length:10},(_,i)=>reserve(uuid(20+i))));
 check('per-user serialized cap allows exactly one further 50-dollar reservation',contenders.filter(x=>x.status==='fulfilled').length,1);
 check('reserved total at most 100 dollars',(await db`select sum(gross_amount_cents)::int n from public.dj_tips`)[0].n,10000);
 await denied('rolling daily cap spans events',()=>reserve(uuid(50),100,otherEvent));
 await db`update public.followup_tip_reservations set created_at=now()-interval '2 days',retry_until=now()-interval '1 day'`;
 await db`update public.dj_tips set checkout_expires_at=now()-interval '1 day'`;
 await denied('ambiguous old reservation never frees cap by time alone',()=>reserve(uuid(51),100));
 const id=retries[0][0].id;
 const apply=(eventId:string,type:string,paid:boolean)=>service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:eventId,event_type:type,reservation_id:id,session_id:'cs_fake',payment_intent:'pi_fake',kind:paid?'paid':type.includes('expired')?'expired':type.includes('failed')?'failed':'pending',terminal:true,amount_cents:5000,currency:'usd',livemode:false})})`);
 await apply('evt_unpaid','checkout.session.completed',false);
 check('completed unpaid does not fulfill',(await db`select status from public.dj_tips where id=${retries[0][0].tip_id}`)[0].status,'pending');
 await apply('evt_expired','checkout.session.expired',false);
 await apply('evt_paid','checkout.session.async_payment_succeeded',true);
 await Promise.all(Array.from({length:10},()=>apply('evt_paid','checkout.session.async_payment_succeeded',true)));
 await apply('evt_late','checkout.session.completed',false);
 await apply('evt_failed','checkout.session.async_payment_failed',false);
 check('late unpaid failure never downgrades paid',(await db`select status from public.dj_tips where id=${retries[0][0].tip_id}`)[0].status,'succeeded');
 check('paid event recorded exactly once',(await db`select count(*)::int n from public.followup_payment_events where event_id='evt_paid'`)[0].n,1);
 await denied('signed mismatched amount cannot settle',()=>service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:'evt_forged',event_type:'checkout.session.completed',reservation_id:id,session_id:'cs_fake',payment_intent:'pi_fake',kind:'paid',amount_cents:1,currency:'usd',livemode:false})})`));
 await denied('different session cannot attach',()=>service(q=>q`select public.followup_attach_tip_session(${id},'cs_other','https://checkout.stripe.com/c/pay/fake',now())`));
 await service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:'evt_refund',event_type:'charge.refunded',reservation_id:id,session_id:'cs_fake',payment_intent:'pi_fake',kind:'refund',refunded_amount_cents:5000,amount_cents:5000,currency:'usd',livemode:false})})`);
 await apply('evt_again','checkout.session.completed',true);
 check('paid redelivery preserves refunds',(await db`select status from public.dj_tips where id=${retries[0][0].tip_id}`)[0].status,'refunded');
 await denied('client reservation execute denied',()=>db.begin(async q=>{await q`set local role authenticated`;return q`select public.followup_reserve_tip(${user},${uuid(60)},${event},100,null,'https://fixture.invalid')`;}));
 check('client reservation table grants closed',(await db`select has_table_privilege('authenticated','public.followup_tip_reservations','select') b`)[0].b,false);
 await denied('service REST writes closed',()=>service(q=>q`update public.dj_tips set status='failed' where id=${retries[0][0].tip_id}`));

 // Fresh identity exercises mixed legacy + new writers under a real parallel barrier.
 const mixed=uuid(3);await db`insert into public.profiles(id,nickname) values(${mixed},'Mixed')`;
 await db`insert into public.event_participants(event_id,user_id,nickname) values(${event},${mixed},'Mixed')`;
 await db`insert into public.purchase_consents(user_id,version) values(${mixed},'v2-tips-2026-06-12')`;
 const legacy=uuid(300);await db`insert into public.dj_tips(id,user_id,dj_id,event_id,gross_amount_cents,platform_fee_cents,net_amount_cents,status,stripe_checkout_session_id,livemode,stripe_destination_account) values(${legacy},${mixed},${dj},${event},5000,1500,3500,'pending','cs_legacy',false,'acct_fake')`;
 const mixedReserve=(key:string,amount=5000)=>service(q=>q`select (public.followup_reserve_tip(${mixed},${key},${event},${amount},null,'https://fixture.invalid')).*`);
 const evidence=(eid:string,kind:string,extra:Record<string,unknown>={})=>service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:eid,event_type:kind,tip_id:legacy,session_id:'cs_legacy',payment_intent:'pi_legacy',amount_cents:5000,currency:'usd',livemode:false,kind,...extra})})`);
 const mixedResults=await Promise.allSettled([evidence('evt_legacy_paid','paid'),...Array.from({length:8},(_,i)=>mixedReserve(uuid(400+i)))]);
 check('legacy settlement racing reservations admits exactly one new 50 tip',mixedResults.slice(1).filter(r=>r.status==='fulfilled').length,1);
 check('legacy settlement succeeds under same mutex',mixedResults[0].status,'fulfilled');
 await Promise.all([evidence('evt_partial_new','refund',{refunded_amount_cents:3000}),evidence('evt_partial_old','refund',{refunded_amount_cents:1000}),evidence('evt_paid_late','paid')]);
 check('parallel stale partial refund cannot regress accounting',(await db`select status,refunded_amount_cents from public.dj_tips where id=${legacy}`)[0],{status:'partially_refunded',refunded_amount_cents:3000});
 await evidence('evt_dispute_closed','dispute_won',{dispute_id:'dp_legacy',created:200});
 await evidence('evt_dispute_open_late','dispute_open',{dispute_id:'dp_legacy',created:100});
 check('out-of-order dispute opening preserves closed win and partial refund',(await db`select status from public.dj_tips where id=${legacy}`)[0].status,'partially_refunded');
 await denied('conflicting closed dispute requires review',()=>evidence('evt_dispute_conflict','dispute_lost',{dispute_id:'dp_legacy',created:300}));
 for(const extra of [{amount_cents:1},{currency:'eur'},{livemode:true},{session_id:'cs_wrong'},{payment_intent:'pi_wrong'},{destination:'acct_wrong'},{fee:1},{tip_id:uuid(999)}])await denied('authoritative mismatch '+JSON.stringify(extra),()=>evidence('evt_mismatch','paid',extra));
 await denied('duplicate event conflicting evidence rejected',()=>evidence('evt_legacy_paid','pending'));
 await Promise.all(Array.from({length:8},()=>evidence('evt_same_refund','refund',{refunded_amount_cents:5000})));
 check('concurrent refund dedup evidence once',(await db`select count(*)::int n from public.followup_payment_events where event_id='evt_same_refund'`)[0].n,1);
 // Parallel refund/reconcile/cap writes never strand pending reservations or regress a full refund.
 await Promise.all([evidence('reconcile:legacy:paid','paid'),mixedReserve(uuid(500)),evidence('evt_stale_refund_after_full','refund',{refunded_amount_cents:2000})]);
 check('reconcile cannot overwrite full refund',(await db`select status,refunded_amount_cents from public.dj_tips where id=${legacy}`)[0],{status:'refunded',refunded_amount_cents:5000});
 const newTip=(await db`select id from public.dj_tips where user_id=${mixed} and id<>${legacy} limit 1`)[0].id;
 await service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:'reconcile:new:review',event_type:'reconciliation',tip_id:newTip,kind:'review',reason:'no_authoritative_session_evidence'})})`);
 check('ambiguity persists durable review state',(await db`select state from public.followup_tip_reservations where tip_id=${newTip}`)[0].state,'review');
 await denied('review amounts retain cap',()=>mixedReserve(uuid(501),100));
 await service(q=>q`select public.followup_apply_financial_event(${q.json({event_id:'reconcile:new:terminal',event_type:'reconciliation',tip_id:newTip,session_id:'cs_terminal',kind:'expired',terminal:true,amount_cents:5000,currency:'usd',livemode:false})})`);
 check('authoritative expiration resolves retained review',(await db`select state from public.followup_tip_reservations where tip_id=${newTip}`)[0].state,'expired');
 const outsider=uuid(4);await db`insert into public.profiles(id,nickname) values(${outsider},'Outside')`;
 await db`insert into public.purchase_consents(user_id,version) values(${outsider},'v2-tips-2026-06-12'),(${dj},'v2-tips-2026-06-12')`;
 const deniedReserve=(u:string)=>service(q=>q`select public.followup_reserve_tip(${u},${uuid(700)},${event},100,null,'https://fixture.invalid')`);
 await denied('nonmember forbidden',()=>deniedReserve(outsider));await denied('owner self tip forbidden',()=>deniedReserve(dj));
 await db`insert into public.event_banned_guests(event_id,user_id) values(${event},${mixed})`;
 await denied('banned member forbidden',()=>deniedReserve(mixed));await db`delete from public.event_banned_guests where user_id=${mixed}`;
 await db`alter table public.events disable trigger user`;
 await db`update public.events set ended_at=now() where id=${event}`;
 await db`alter table public.events enable trigger user`;
 await denied('ended_at alone rejects new reservation',()=>deniedReserve(mixed));

 // Review is financially durable; retry permission may fail without changing accounting.
 await denied('banned retry denied without deleting reservation',()=>db.begin(async q=>{
  await q`insert into public.event_banned_guests(event_id,user_id) values(${event},${user})`;
  await q`set local role service_role`;await q`select set_config('request.jwt.claim.role','service_role',true)`;
  return q`select public.followup_reserve_tip(${user},${uuid(10)},${event},5000,null,'https://changed.invalid')`;
 }));
 const frozen=await reserve(uuid(10));check('retry preserves originally frozen success redirect',frozen[0].checkout_parameters.success_url,'https://fixture.invalid/event/PAY001?tip=success');
 check('retry returns original financial evidence after event ends',frozen[0].tip_id,retries[0][0].tip_id);
 // Authorization and current consent are checked before new reservation; retry does not mutate consent evidence.
 check('no balance mutations introduced',(await db`select points from public.profiles where id=${user}`)[0].points,2);

 for(const table of ['followup_tip_reservations','followup_payment_events','followup_tip_financial_state','followup_account_evidence']){
  check('service direct UPDATE closed '+table,(await db`select has_table_privilege('service_role',${'public.'+table},'update') b`)[0].b,false);
  check('private RLS enabled '+table,(await db`select relrowsecurity b from pg_class where oid=${'public.'+table}::regclass`)[0].b,true);
 }
 await Promise.all(Array.from({length:8},()=>service(q=>q`select public.followup_sync_account(${q.json({account_id:'acct_fake',created:200,payouts_enabled:true,charges_enabled:true,details_submitted:true,livemode:false})})`)));
 await service(q=>q`select public.followup_sync_account(${q.json({account_id:'acct_fake',created:100,payouts_enabled:false,charges_enabled:false,details_submitted:false,livemode:false})})`);
 check('old account event cannot revert authoritative payouts',(await db`select payouts_enabled from public.dj_payout_accounts where user_id=${dj}`)[0].payouts_enabled,true);
 check('notification remains domain blocked not sent',(await db`select notification_state from public.followup_account_evidence where account_id='acct_fake'`)[0].notification_state,'domain_not_configured');
 console.log(`RESULT ${count} payment assertions passed with real concurrent connections`);
}finally{await db.end();}