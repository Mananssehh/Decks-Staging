// Independent reviewer installed payment-v3 in staging; every financial endpoint checks the hosted marker.
export interface RpcClient { rpc(name:string, args?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}> }
export async function paymentRpc<T>(db:RpcClient,name:string,args?:Record<string,unknown>):Promise<T> {
 const {data,error}=await db.rpc(name,args); if(error)throw error; return data as T;
}
export async function requirePaymentContract(db:RpcClient) {
 if(await paymentRpc<string>(db,'followup_payment_contract')!=='payment-v3') throw Error('Payment integration not installed');
}
export function safeOrigin(value:string|undefined):string {
 if(!value)throw Error('APP_ORIGIN missing'); const u=new URL(value);
 if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw Error('Invalid APP_ORIGIN'); return value;
}
export function paymentOrigin(configured:string|undefined,backendUrl:string|undefined):string {
 if(configured!==undefined&&configured!=='')return safeOrigin(configured);
 if(backendUrl==='https://ldxgejbzmpvsvozqmpfe.supabase.co')return 'https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app';
 throw Error('APP_ORIGIN missing');
}
