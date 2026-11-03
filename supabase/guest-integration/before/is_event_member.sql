CREATE OR REPLACE FUNCTION public.is_event_member(_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_participants p
    WHERE p.event_id = _event_id AND p.user_id = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.event_banned_guests b
    WHERE b.event_id = _event_id AND b.user_id = auth.uid()
  );
$function$
;
