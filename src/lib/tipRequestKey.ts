/** A logical checkout is the user/event/song/amount, not a click or an HTTP attempt. */
export function tipRequestKey(userId:string,eventId:string,songId:string|null,amount:number,storage:Storage=localStorage) {
 const key=`decks:tip-request:${userId}:${eventId}:${songId??''}:${amount}`;
 const current=storage.getItem(key);
 if(current&&/^[a-f0-9-]{36}$/i.test(current))return current;
 const next=crypto.randomUUID();storage.setItem(key,next);return next;
}