export interface SignedPaymentEvent {
 id:string;type:string;livemode:boolean;
 data:{object:{id:string;metadata?:{reservation_id?:string};payment_status?:string;status?:string;payment_intent?:string|object|null;amount_total?:number;currency?:string}};
}
export async function handleReservedPayment(
 req:Request,
 verify:(raw:string,signature:string)=>Promise<SignedPaymentEvent>,
 apply:(args:Record<string,unknown>)=>Promise<void>,
):Promise<Response> {
 if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});
 const signature=req.headers.get('stripe-signature');if(!signature)return Response.json({error:'Missing signature'},{status:400});
 let event:SignedPaymentEvent;
 try{event=await verify(await req.text(),signature);}catch{return Response.json({error:'Invalid signature'},{status:400});}
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))return Response.json({received:true});
 const s=event.data.object;
 if(!s.metadata?.reservation_id)return Response.json({error:'Legacy checkout requires reviewed legacy path'},{status:409});
 try {
  await apply({_event_id:event.id,_event_type:event.type,_reservation_id:s.metadata.reservation_id,_session_id:s.id,
   _payment_intent:typeof s.payment_intent==='string'?s.payment_intent:null,
   _paid:s.payment_status==='paid'&&s.status==='complete',_amount_cents:s.amount_total,_currency:s.currency,_livemode:event.livemode});
  return Response.json({received:true});
 }catch{return Response.json({error:'Settlement unavailable; retry required'},{status:503});}
}