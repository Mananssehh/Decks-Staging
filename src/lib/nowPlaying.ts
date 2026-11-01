import { supabase } from "@/integrations/supabase/client";
import { writeBroadcast } from "@/lib/stagedRepairs";

export type NowPlayingStatus = "playing" | "mixing" | "paused";

export interface NowPlayingRow {
  id: string;
  event_id: string;
  title: string;
  artist: string | null;
  album_art: string | null;
  apple_url: string | null;
  spotify_url: string | null;
  source: string | null;
  status: NowPlayingStatus;
  updated_at: string;
}

export interface NowPlayingInput {
  eventId: string;
  title: string;
  artist?: string;
  albumArt?: string;
  appleUrl?: string | null;
  spotifyUrl?: string | null;
  source?: string;
  status?: NowPlayingStatus;
}

export async function updateNowPlaying({
  eventId,
  title,
  artist = "",
  albumArt = "",
  appleUrl = null,
  spotifyUrl = null,
  source = "manual",
  status = "playing",
}: NowPlayingInput): Promise<NowPlayingRow> {
  if (!eventId || !title) throw new Error("eventId and title are required");

  const data = await writeBroadcast(eventId, {
    title, artist, album_art: albumArt, apple_url: appleUrl,
    spotify_url: spotifyUrl, source, status,
  });
  return data as unknown as NowPlayingRow;
}

export async function fetchNowPlaying(eventId: string): Promise<NowPlayingRow | null> {
  const { data, error } = await supabase
    .from("now_playing")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as NowPlayingRow) ?? null;
}
