CREATE OR REPLACE FUNCTION public.recent_request_count(_event_id uuid, _seconds integer DEFAULT 30)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.song_requests
  where event_id = _event_id
    and requested_by = auth.uid()
    and created_at > now() - make_interval(secs => _seconds)
$function$
;
