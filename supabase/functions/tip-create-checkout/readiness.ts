import { paymentOrigin,requirePaymentContract,type RpcClient } from '../_shared/payment-contract.ts';

export interface ReadinessTip {event_id:string|null;status:string;gross_amount_cents:number;created_at:string}
export interface ReadinessDeps {
 db:RpcClient; origin:string|undefined; backendUrl:string; mode:'test'|'live'|'unknown'; now:()=>number;
 event:()=>Promise<{dj_id:string;is_active:boolean;ended_at:string|null;requests_status:string}|null>;
 member:()=>Promise<boolean>; banned:()=>Promise<boolean>;
 payout:(djId:string)=>Promise<{charges_enabled:boolean;payouts_enabled:boolean;livemode:boolean;stripe_account_id:string}|null>;
 tips:(offset:number)=>Promise<ReadinessTip[]>;
}
// Read-only advisory snapshot, never permission to skip the atomic reservation boundary.
// All pending (including aged/ambiguous reservation and legacy tips) retain quota, matching installed SQL.
export async function checkReadiness(userId:string,eventId:string,amountCents:number,deps:ReadinessDeps){
 await requirePaymentContract(deps.db);
 paymentOrigin(deps.origin,deps.backendUrl);
 if(deps.mode==='unknown')return {ready:false,error_code:'STRIPE_CONFIG_ERROR'};
 if(!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>5000)return {ready:false,error_code:'INVALID_REQUEST'};
 const event=await deps.event();
 if(!event||!event.is_active||event.ended_at||event.requests_status==='ended')return {ready:false,error_code:'EVENT_NOT_FOUND'};
 if(event.dj_id===userId)return {ready:false,error_code:'SELF_TIP'};
 if(!await deps.member()||await deps.banned())return {ready:false,error_code:'EVENT_NOT_FOUND'};
 const payout=await deps.payout(event.dj_id);
 if(!payout?.stripe_account_id||!payout.charges_enabled||!payout.payouts_enabled||payout.livemode!==(deps.mode==='live'))return {ready:false,error_code:'DJ_PAYOUTS_NOT_READY'};
 let daily=0,eventTotal=0;
 const cutoff=deps.now()-24*60*60*1000;
 for(let offset=0;;offset+=1000){
  const rows=await deps.tips(offset);
  for(const row of rows){
   if(!Number.isSafeInteger(row.gross_amount_cents)||row.gross_amount_cents<0||!Number.isFinite(Date.parse(row.created_at)))throw Error('Invalid cap evidence');
   if(row.status==='pending'||row.status==='succeeded'&&Date.parse(row.created_at)>cutoff)daily+=row.gross_amount_cents;
   if(row.event_id===eventId&&(row.status==='pending'||row.status==='succeeded'))eventTotal+=row.gross_amount_cents;
  }
  if(daily+amountCents>10000||eventTotal+amountCents>10000)return {ready:false,error_code:'TIP_LIMIT_REACHED'};
  if(rows.length<1000)break;
 }
 return {ready:true,ok:true,advisory:true};
}