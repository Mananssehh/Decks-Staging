import {assertEquals,assertRejects} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {checkReadiness,type ReadinessDeps} from './readiness.ts';
import {paymentOrigin} from '../_shared/payment-contract.ts';
function fixture(){
 const deps:ReadinessDeps={db:{rpc:async()=>({data:'payment-v3',error:null})},origin:'https://fixture.invalid',backendUrl:'https://unknown.invalid',mode:'test',now:()=>1800000000000,event:async()=>({dj_id:'dj',is_active:true,ended_at:null,requests_status:'open'}),member:async()=>true,banned:async()=>false,payout:async()=>({stripe_account_id:'acct_fake',charges_enabled:true,payouts_enabled:true,livemode:false}),tips:async()=>[]};
 return deps;
}
Deno.test('readiness checks missing contract and origin before returning ready',async()=>{
 const d=fixture();d.db.rpc=async()=>({data:null,error:Error('Payment integration not installed')});await assertRejects(()=>checkReadiness('u','e',100,d));
 d.db.rpc=async()=>({data:'payment-v3',error:null});d.origin=undefined;await assertRejects(()=>checkReadiness('u','e',100,d));
 d.origin='https://fixture.invalid/path';await assertRejects(()=>checkReadiness('u','e',100,d));
});
Deno.test('readiness rejects nonmember, banned, ended_at and retained pending caps without requiring consent',async()=>{
 const d=fixture();assertEquals((await checkReadiness('u','e',100,d)).ready,true);
 d.member=async()=>false;assertEquals((await checkReadiness('u','e',100,d)).ready,false);
 d.member=async()=>true;d.banned=async()=>true;assertEquals((await checkReadiness('u','e',100,d)).ready,false);
 d.banned=async()=>false;d.event=async()=>({dj_id:'dj',is_active:true,requests_status:'open',ended_at:'2026-01-01'});assertEquals((await checkReadiness('u','e',100,d)).ready,false);
 d.event=fixture().event;d.tips=async()=>[{event_id:'e',status:'pending',gross_amount_cents:10000,created_at:'2020-01-01'}];assertEquals((await checkReadiness('u','e',100,d)).error_code,'TIP_LIMIT_REACHED');
 d.tips=async()=>[{event_id:'other',status:'pending',gross_amount_cents:10000,created_at:'2020-01-01'}];assertEquals((await checkReadiness('u','e',100,d)).error_code,'TIP_LIMIT_REACHED');
 d.tips=async()=>[{event_id:'e',status:'succeeded',gross_amount_cents:10000,created_at:'2020-01-01'}];assertEquals((await checkReadiness('u','e',100,d)).error_code,'TIP_LIMIT_REACHED');
});
Deno.test('readiness pages retained accounting and does not promise concurrent admission',async()=>{
 const d=fixture();const offsets:number[]=[];
 d.tips=async(offset)=>{offsets.push(offset);return offset===0?Array.from({length:1000},()=>({event_id:'old',status:'succeeded',gross_amount_cents:100,created_at:'2020-01-01'})):[{event_id:'e',status:'pending',gross_amount_cents:10000,created_at:'2020-01-01'}];};
 assertEquals((await checkReadiness('u','e',100,d)).ready,false);assertEquals(offsets,[0,1000]);
 d.tips=async()=>[];assertEquals((await checkReadiness('u','e',100,d)).advisory,true);
});
Deno.test('exact staging fallback only; configured safe origin preserved, production and unknown fail closed',async()=>{
 const staging='https://ldxgejbzmpvsvozqmpfe.supabase.co';
 assertEquals(paymentOrigin(undefined,staging),'https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app');
 assertEquals(paymentOrigin('https://configured.invalid',staging),'https://configured.invalid');
 for(const backend of ['https://production.invalid',staging+'/',undefined])await assertRejects(async()=>paymentOrigin(undefined,backend));
 await assertRejects(async()=>paymentOrigin('http://unsafe.invalid',staging));
});
