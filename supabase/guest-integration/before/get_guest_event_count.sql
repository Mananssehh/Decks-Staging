CREATE OR REPLACE FUNCTION public.get_guest_event_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(count(DISTINCT event_id), 0)::int
  FROM public.event_participants
  WHERE user_id = auth.uid()
$function$
;
