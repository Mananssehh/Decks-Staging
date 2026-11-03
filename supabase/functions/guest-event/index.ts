// SOURCE ONLY. Deploy only after independent install and contract verification.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler, staging, type Rpc } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let rpc: Rpc|undefined;
if(url && key && staging(url)){
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 rpc=async(action,payload)=>{
  if(action==='consent'){const {data,error}=await admin.rpc('guest_application_actor',{_event_id:payload.event_id,_token:payload.token,_operation:'consent'});return {data,error};}
  if(action==='public_profile'){const {data,error}=await admin.rpc('guest_event_public_profile',{_event_id:payload.event_id,_token:payload.token,_target:payload.target_id});return {data,error};}
  if(action==='tip_summary'){const {data,error}=await admin.rpc('guest_tip_summary',{_event_id:payload.event_id,_token:payload.token});return {data,error};}
  const {data,error}=await admin.rpc('guest_event_api',{_action:action,_payload:payload});return {data,error};
 };
}
Deno.serve(createHandler({url,rpc}));
