import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Source-only contracts: generated hosted types remain unchanged until SQL is applied. */
type RepairContracts = {
  set_song_vote: { args: { _song_request_id: string; _value: number | null }; result: null };
  dj_transition_request: { args: { _event_id: string; _song_request_id: string; _status: string }; result: null };
  repair_write_broadcast: { args: { _event_id: string; _row: Json }; result: Json };
};
type RepairClient = {
  rpc<K extends keyof RepairContracts>(name: K, args: RepairContracts[K]["args"]): PromiseLike<{
    data: RepairContracts[K]["result"] | null;
    error: { message: string } | null;
  }>;
};
const client = supabase as unknown as RepairClient;

export async function setSongVote(songId: string, value: 1 | -1 | null) {
  const { error } = await client.rpc("set_song_vote", { _song_request_id: songId, _value: value });
  if (error) throw error;
}

export async function transitionRequest(eventId: string, songId: string, status: string) {
  const { error } = await client.rpc("dj_transition_request", {
    _event_id: eventId, _song_request_id: songId, _status: status,
  });
  if (error) throw error;
}

export async function writeBroadcast(eventId: string, row: Json) {
  const { data, error } = await client.rpc("repair_write_broadcast", { _event_id: eventId, _row: row });
  if (error) throw error;
  if (!data) throw new Error("Broadcast was not saved");
  return data;
}