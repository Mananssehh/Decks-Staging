export interface Reservation {
 id:string; tip_id:string; user_id:string; amount_cents:number; retry_until:string;
 session_id:string|null; session_url:string|null; state:string;
 checkout_parameters: {destination:string;livemode:boolean;fee:number;room_code:string;dj_name:string;event_name:string;expires_at:number;song_request_id:string|null};
}
export interface CheckoutInput { request_key:string; event_id:string; amount_cents:number; song_request_id?:string|null }
export interface CheckoutDeps {
 reserve:(user:string,input:CheckoutInput)=>Promise<Reservation>;
 create:(params:Record<string,unknown>,options:{idempotencyKey:string})=>Promise<{id:string;url:string|null;expires_at:number}>;
 attach:(id:string,session:{id:string;url:string|null;expires_at:number})=>Promise<void>;
 origin:string; live:boolean; now:()=>number;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function createReservedCheckout(userId:string,input:CheckoutInput,deps:CheckoutDeps) {
 if(!uuid.test(input.request_key)||!uuid.test(input.event_id)||!Number.isSafeInteger(input.amount_cents)||input.amount_cents<100||input.amount_cents>5000) throw Error("Invalid request");
 const r=await deps.reserve(userId,input);
 if(r.session_id&&r.session_url&&r.state==='attached') return {session_id:r.session_id,url:r.session_url};
 if(!['reserved','ambiguous','attached'].includes(r.state)) throw Error("Checkout already settled");
 if(deps.now()>Date.parse(r.retry_until)) throw Error("Reconciliation required; reservation retained");
 const p=r.checkout_parameters;
 if(p.livemode!==deps.live) throw Error("Payout mode mismatch");
 // Exact immutable provider parameters are derived from the DB reservation, not from retry headers/body.
 const params={mode:'payment',payment_method_types:['card'],expires_at:p.expires_at,
 line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:r.amount_cents,product_data:{name:`Tip for DJ ${p.dj_name}`}}}],
 payment_intent_data:{application_fee_amount:p.fee,transfer_data:{destination:p.destination},metadata:{reservation_id:r.id,tip_id:r.tip_id}},
 metadata:{reservation_id:r.id,tip_id:r.tip_id},
 success_url:`${deps.origin}/event/${encodeURIComponent(p.room_code)}?tip=success`,
 cancel_url:`${deps.origin}/event/${encodeURIComponent(p.room_code)}?tip=cancel`};
 // Timeouts are ambiguous. Never release reservation or rotate request/provider key on error.
 const session=await deps.create(params,{idempotencyKey:`decks-tip:${r.id}`});
 if(!session.url||!session.url.startsWith('https://checkout.stripe.com/')) throw Error("Checkout URL unavailable; reservation retained");
 await deps.attach(r.id,session);
 return {session_id:session.id,url:session.url};
}