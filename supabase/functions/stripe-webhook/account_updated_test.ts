import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleAccountUpdated,type PayoutStore } from './account-updated.ts';
Deno.test('payout activation remains authoritative; disabled/failed email is not invoked or marked sent',async()=>{
 let enabled=false,mail=0;
 const store:PayoutStore={getPrevious:async()=>({data:{user_id:'fixture',payouts_enabled:false},error:null}),syncStatus:async()=>({affected:1,error:null}),claimActivation:async()=>{throw Error('must not claim mail with finances');},setPayoutsEnabled:async(_,value)=>{enabled=value;return {affected:1,error:null};}};
 const result=await handleAccountUpdated({id:'acct_fixture',payouts_enabled:true},{store,getUserEmail:async()=>null,getNickname:async()=>null,sendEmail:async()=>{mail++;throw Error('disabled');}});
 assertEquals(enabled,true);assertEquals(mail,0);assertEquals(result.emailQueued,false);assertEquals(result.outcome,'notification_domain_blocked');
 store.syncStatus=async()=>({affected:0,error:Error('down')});assertEquals((await handleAccountUpdated({id:'acct_fixture'}, {store,getUserEmail:async()=>null,getNickname:async()=>null,sendEmail:async()=>{}})).ok,false);assertEquals(enabled,true);
});
