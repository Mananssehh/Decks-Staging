// Financial correctness never depends on mail. Canonical webhook uses followup_sync_account.
// Compatibility helper for existing-schema callers; all actual provider account events use canonical RPC routing.
export interface PayoutAccountRow {user_id:string;payouts_enabled:boolean}
export interface PayoutStore {
 getPrevious:(id:string)=>Promise<{data:PayoutAccountRow|null;error:unknown}>;
 syncStatus:(id:string,fields:{charges_enabled:boolean;details_submitted:boolean;livemode:boolean;last_synced_at:string})=>Promise<{affected:number;error:unknown}>;
 claimActivation:(id:string)=>Promise<{claimed:boolean;error:unknown}>;
 setPayoutsEnabled:(id:string,value:boolean)=>Promise<{affected:number;error:unknown}>;
}
export interface AccountUpdatedDeps {store:PayoutStore;getUserEmail:(id:string)=>Promise<string|null>;getNickname:(id:string)=>Promise<string|null>;sendEmail:(opts:{templateName:string;recipientEmail:string|null|undefined;idempotencyKey:string;templateData:Record<string,unknown>})=>Promise<void|{sent:false;reason:string}>}
export interface StripeAccountLike {id:string;charges_enabled?:boolean;payouts_enabled?:boolean;details_submitted?:boolean;livemode?:boolean}
export async function handleAccountUpdated(acct:StripeAccountLike,deps:AccountUpdatedDeps){
 const prev=await deps.store.getPrevious(acct.id);
 if(prev.error)return {ok:false,outcome:'lookup_failed',emailQueued:false};
 if(!prev.data)return {ok:false,outcome:'no_account_row',emailQueued:false};
 const sync=await deps.store.syncStatus(acct.id,{charges_enabled:!!acct.charges_enabled,details_submitted:!!acct.details_submitted,livemode:!!acct.livemode,last_synced_at:new Date().toISOString()});
 if(sync.error||sync.affected!==1)return {ok:false,outcome:'sync_failed',emailQueued:false};
 const payouts=await deps.store.setPayoutsEnabled(acct.id,!!acct.payouts_enabled);
 if(payouts.error||payouts.affected!==1)return {ok:false,outcome:'sync_failed',emailQueued:false};
 // No send/claim/revert: official domain setup is a provider gate, not financial authorization.
 return {ok:true,outcome:'notification_domain_blocked',emailQueued:false};
}
