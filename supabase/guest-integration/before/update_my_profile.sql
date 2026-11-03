CREATE OR REPLACE FUNCTION public.update_my_profile(_nickname text DEFAULT NULL::text, _is_public boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid  uuid := auth.uid();
  _nick text;
  _p    public.profiles;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  _nick := nullif(btrim(coalesce(_nickname, '')), '');
  IF _nick IS NOT NULL AND (length(_nick) < 2 OR length(_nick) > 24) THEN
    RAISE EXCEPTION 'nickname_length' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles p
     SET nickname   = coalesce(_nick, p.nickname),
         is_public  = coalesce(_is_public, p.is_public),
         updated_at = now()
   WHERE p.id = _uid
   RETURNING * INTO _p;

  IF _p.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id', _p.id,
    'nickname', _p.nickname,
    'points', _p.points,
    'is_premium', _p.is_premium,
    'is_public', _p.is_public,
    'created_at', _p.created_at,
    'updated_at', _p.updated_at
  );
END;
$function$
;
