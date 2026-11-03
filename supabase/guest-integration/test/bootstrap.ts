import postgres from 'postgres';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const db=postgres({host:process.env.PGHOST,port:Number(process.env.PGPORT),username:'postgres',database:'reviewed_bootstrap',onnotice:()=>{}});
const source=readFileSync(new URL('../000_targeted_bootstrap.sql',import.meta.url),'utf8');
const u='46d7d47d-1b21-4351-a268-a1ccf95e1f42';
let checks=0;
function eq(a:unknown,b:unknown,label:string){assert.deepEqual(a,b,label);checks++;console.log('PASS',label);}
try{
 await db`alter table auth.users disable trigger user`;
 await db`insert into auth.users(id,is_anonymous,raw_user_meta_data) values(${u},true,'{"nickname":"Legacy DJ"}')`;
 await db`alter table auth.users enable trigger user`;
 await db`insert into public.user_roles(user_id,role) values(${u},'dj')`;
 await db`insert into public.events(dj_id,name,dj_name,room_code) values(${u},'Existing','Existing','LEGACY')`;
 const before=(await db`select jsonb_agg(to_jsonb(p) order by id) r from public.profiles p`)[0].r;
 const auth=(await db`select to_jsonb(a) r from auth.users a where id=${u}`)[0].r;
 const event=(await db`select to_jsonb(e) r from public.events e where dj_id=${u}`)[0].r;
 // Every negative executes in a rolled-back local transaction, never changes baseline.
 const refuse=async(label:string,change:(q:postgres.TransactionSql)=>Promise<unknown>)=>{
  let rejected=false;
  try{await db.begin(async q=>{await change(q);await q.unsafe(source);});}catch{rejected=true;}
  eq(rejected,true,label);
 };
 await refuse('repair refuses changed anonymous flag',q=>q`update auth.users set is_anonymous=false where id=${u}`);
 await refuse('repair refuses missing DJ role',q=>q`delete from public.user_roles where user_id=${u}`);
 await refuse('repair refuses changed event ownership',q=>q`delete from public.events where dj_id=${u}`);
 await refuse('repair refuses preexisting ledger',q=>q`insert into public.points_transactions(user_id,amount,type,reason) values(${u},1,'earned','Unexpected')`);
 await refuse('repair refuses unexpected profile',q=>q`insert into public.profiles(id,nickname,points) values(${u},'Other',15)`);
 await refuse('repair refuses payout evidence',q=>q`insert into public.dj_payout_accounts(user_id,stripe_account_id) values(${u},'acct_local')`);
 await refuse('repair refuses membership evidence',q=>q`insert into public.event_participants(event_id,user_id,nickname) select id,${u},'Legacy' from public.events where dj_id=${u}`);
 // Metadata fallback is identical to normal bootstrap, also no history backdating.
 try{await db.begin(async q=>{
  await q`update auth.users set raw_user_meta_data='{}' where id=${u}`;await q.unsafe(source);
  eq((await q`select nickname from public.profiles where id=${u}`)[0].nickname,'Guest','repair uses existing Guest fallback');
  throw new Error('rollback fallback fixture');
 });}catch(e){if(!(e instanceof Error)||e.message!=='rollback fallback fixture')throw e;}
 const started=new Date();await db.begin(q=>q.unsafe(source));
 eq((await db`select nickname,points,is_public,is_premium from public.profiles where id=${u}`)[0],{nickname:'Legacy DJ',points:15,is_public:false,is_premium:false},'repair exact metadata/bootstrap defaults');
 eq((await db`select amount,type,reason,event_id,song_request_id,created_by from public.points_transactions where user_id=${u}`)[0],{amount:15,type:'earned',reason:'Starter points',event_id:null,song_request_id:null,created_by:null},'repair one exact Starter ledger');
 eq((await db`select created_at from public.points_transactions where user_id=${u}`)[0].created_at>=started,true,'repair timestamps are current not backdated');
 await db.begin(q=>q.unsafe(source));
 eq((await db`select count(*)::int n from public.points_transactions where user_id=${u}`)[0].n,1,'repair retry no extra credit');
 eq((await db`select jsonb_agg(to_jsonb(p) order by id) r from public.profiles p where id<>${u}`)[0].r,before,'all existing profiles byte-for-byte unchanged');
 eq((await db`select to_jsonb(a) r from auth.users a where id=${u}`)[0].r,auth,'repair preserves original Auth metadata/flag');
 eq((await db`select to_jsonb(e) r from public.events e where dj_id=${u}`)[0].r,event,'repair preserves original event');
 console.log(`RESULT ${checks} targeted bootstrap assertions passed`);
}finally{await db.end();}