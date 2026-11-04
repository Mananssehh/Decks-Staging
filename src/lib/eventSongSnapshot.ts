import { supabase } from '@/integrations/supabase/client';
import type { SongRequestRow } from '@/components/SongRequestCard';
import { monitored } from './monitoring';

/** Counters and this user's selected vote share one PostgreSQL statement snapshot. */
export async function loadEventSongs(eventId:string,userId:string,db:typeof supabase=supabase){
 return monitored('snapshot',async()=>{
 const {data,error}=await db.from('song_requests')
  .select('*, votes!left(user_id,value)')
  .eq('event_id',eventId).eq('votes.user_id',userId);
 if(error)throw error;
 const votes:Record<string,1|-1>={};
 const songs:SongRequestRow[]=(data??[]).map(({votes:embedded,...song})=>{
  for(const vote of embedded){
   if(vote.user_id===userId&&(vote.value===1||vote.value===-1))votes[song.id]=vote.value;
  }
  return song;
 });
 return {songs,votes};
 });
}