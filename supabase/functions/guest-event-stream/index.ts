// SOURCE ONLY. Independent install/review before deploying ONLY this new endpoint.
// Future deployment: verify_jwt=false; event token verified by fixed private RPC.
import {createClient} from 'npm:@supabase/supabase-js@2';
import {staging,type Backend,type AuthResult,type PollResult} from './protocol.ts';
import {Hubs} from './hubs.ts';
import {createHandler} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let backend:Backend|undefined;
if(url&&key&&staging(url)){
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}});
 backend={auth:async(event,token)=>{const {data,error}=await admin.rpc('guest_stream_auth',{_event_id:event,_token:token});return error?{ok:false,status:503}:data as AuthResult;},poll:async(event,sessions)=>{const {data,error}=await admin.rpc('guest_stream_poll',{_event_id:event,_session_ids:sessions});return error?{ok:false,status:503}:data as PollResult;}};
}
const unavailable:Backend={auth:async()=>({ok:false,status:503}),poll:async()=>({ok:false,status:503})};
const hubs=new Hubs(backend??unavailable);
addEventListener('beforeunload',()=>hubs.shutdown());
Deno.serve(createHandler(url,backend,hubs,req=>Deno.upgradeWebSocket(req)));