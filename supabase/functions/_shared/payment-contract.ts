// SOURCE ONLY until repair-followup 01/02 are independently installed. Never auto-deploy payment functions.
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
