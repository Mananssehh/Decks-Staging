// SOURCE ONLY. Deploy only after independent install and contract verification.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler, staging, type Rpc } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let rpc: Rpc|undefined;
if(url && key && staging(url)){
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 rpc=async(action,payload)=>{const {data,error}=await admin.rpc('guest_event_api',{_action:action,_payload:payload});return {data,error};};
}
Deno.serve(createHandler({url,rpc}));
