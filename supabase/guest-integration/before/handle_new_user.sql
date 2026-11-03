CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, nickname, points)
  VALUES (new.id, coalesce(new.raw_user_meta_data->>'nickname', 'Guest'), 15)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'guest')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Starter ledger row, guarded by partial unique index
  BEGIN
    INSERT INTO public.points_transactions (user_id, amount, type, reason)
    VALUES (new.id, 15, 'earned'::public.point_tx_type, 'Starter points');
  EXCEPTION WHEN unique_violation THEN
    -- already granted, do nothing
    NULL;
  END;

  RETURN new;
END;
$function$
;
