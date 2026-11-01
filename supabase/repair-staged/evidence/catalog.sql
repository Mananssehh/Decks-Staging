-- Read-only live staging catalog captured 2026-11-01; no user data.
CREATE TABLE public.app_config (
key text NOT NULL,
value jsonb NOT NULL,
updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.boost_purchases (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
event_id uuid,
song_request_id uuid,
amount_cents integer NOT NULL,
currency text NOT NULL DEFAULT 'usd'::text,
status text NOT NULL DEFAULT 'pending'::text,
stripe_payment_intent_id text,
consent_version text,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.bridge_pair_attempts (
id uuid NOT NULL DEFAULT gen_random_uuid(),
ip text NOT NULL,
success boolean NOT NULL DEFAULT false,
attempted_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.bridge_pairing_codes (
id uuid NOT NULL DEFAULT gen_random_uuid(),
code text NOT NULL,
event_id uuid NOT NULL,
created_by uuid NOT NULL,
expires_at timestamp with time zone NOT NULL,
claimed_at timestamp with time zone,
claimed_ip text,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.dj_payout_accounts (
user_id uuid NOT NULL,
stripe_account_id text NOT NULL,
charges_enabled boolean NOT NULL DEFAULT false,
payouts_enabled boolean NOT NULL DEFAULT false,
details_submitted boolean NOT NULL DEFAULT false,
livemode boolean NOT NULL DEFAULT false,
last_synced_at timestamp with time zone,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.dj_role_claims (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
attempted_at timestamp with time zone NOT NULL DEFAULT now(),
success boolean NOT NULL DEFAULT false
);
CREATE TABLE public.dj_tips (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
dj_id uuid NOT NULL,
event_id uuid,
gross_amount_cents integer NOT NULL,
platform_fee_cents integer NOT NULL,
net_amount_cents integer NOT NULL,
currency text NOT NULL DEFAULT 'usd'::text,
status text NOT NULL DEFAULT 'pending'::text,
stripe_checkout_session_id text,
stripe_payment_intent_id text,
stripe_destination_account text,
livemode boolean NOT NULL DEFAULT false,
failure_reason text,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
stripe_charge_id text,
refunded_amount_cents integer NOT NULL DEFAULT 0,
refund_id text,
refunded_at timestamp with time zone,
song_request_id uuid,
song_title text,
artist text,
guest_nickname text,
checkout_expires_at timestamp with time zone
);
CREATE TABLE public.email_send_log (
id uuid NOT NULL DEFAULT gen_random_uuid(),
message_id text,
template_name text NOT NULL,
recipient_email text NOT NULL,
status text NOT NULL,
error_message text,
metadata jsonb,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.email_send_state (
id integer NOT NULL DEFAULT 1,
retry_after_until timestamp with time zone,
batch_size integer NOT NULL DEFAULT 10,
send_delay_ms integer NOT NULL DEFAULT 200,
auth_email_ttl_minutes integer NOT NULL DEFAULT 15,
transactional_email_ttl_minutes integer NOT NULL DEFAULT 60,
updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.email_unsubscribe_tokens (
id uuid NOT NULL DEFAULT gen_random_uuid(),
token text NOT NULL,
email text NOT NULL,
created_at timestamp with time zone NOT NULL DEFAULT now(),
used_at timestamp with time zone
);
CREATE TABLE public.error_logs (
id uuid NOT NULL DEFAULT gen_random_uuid(),
severity error_severity NOT NULL DEFAULT 'warning'::error_severity,
source text NOT NULL,
message text NOT NULL,
context jsonb,
stack text,
user_id uuid,
route text,
user_agent text,
reviewed boolean NOT NULL DEFAULT false,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.event_banned_guests (
id uuid NOT NULL DEFAULT gen_random_uuid(),
event_id uuid NOT NULL,
user_id uuid NOT NULL,
reason text,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.event_blocklist (
id uuid NOT NULL DEFAULT gen_random_uuid(),
event_id uuid NOT NULL,
kind text NOT NULL,
value text NOT NULL,
created_at timestamp with time zone NOT NULL DEFAULT now(),
created_by uuid
);
CREATE TABLE public.event_integrations (
id uuid NOT NULL DEFAULT gen_random_uuid(),
event_id uuid NOT NULL,
source_type text NOT NULL DEFAULT 'manual'::text,
ingest_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'::text),
settings jsonb NOT NULL DEFAULT '{}'::jsonb,
last_seen_at timestamp with time zone,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.event_participants (
id uuid NOT NULL DEFAULT gen_random_uuid(),
event_id uuid NOT NULL,
user_id uuid NOT NULL,
nickname text NOT NULL DEFAULT 'Guest'::text,
joined_at timestamp with time zone NOT NULL DEFAULT now(),
last_seen_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.events (
id uuid NOT NULL DEFAULT gen_random_uuid(),
dj_id uuid NOT NULL,
name text NOT NULL,
venue text,
dj_name text NOT NULL,
room_code text NOT NULL,
is_active boolean NOT NULL DEFAULT true,
created_at timestamp with time zone NOT NULL DEFAULT now(),
requests_status text NOT NULL DEFAULT 'live'::text,
archived_at timestamp with time zone,
ended_at timestamp with time zone,
allow_explicit boolean NOT NULL DEFAULT true,
require_approval boolean NOT NULL DEFAULT false,
cooldown_seconds integer NOT NULL DEFAULT 30,
rules_text text
);
CREATE TABLE public.guest_funnel_events (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
event_id uuid,
event_type text NOT NULL,
metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.now_playing (
id uuid NOT NULL DEFAULT gen_random_uuid(),
event_id uuid NOT NULL,
title text NOT NULL,
artist text,
album_art text,
source text DEFAULT 'manual'::text,
status text NOT NULL DEFAULT 'playing'::text,
updated_at timestamp with time zone NOT NULL DEFAULT now(),
created_at timestamp with time zone NOT NULL DEFAULT now(),
started_at timestamp with time zone,
source_track_id text,
now_playing_request_id uuid,
apple_url text,
spotify_url text
);
CREATE TABLE public.points_transactions (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
event_id uuid,
song_request_id uuid,
amount integer NOT NULL,
type point_tx_type NOT NULL,
reason text NOT NULL DEFAULT ''::text,
created_by uuid,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.profiles (
id uuid NOT NULL,
nickname text NOT NULL DEFAULT 'Guest'::text,
points integer NOT NULL DEFAULT 0,
is_premium boolean NOT NULL DEFAULT false,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
is_public boolean NOT NULL DEFAULT true
);
CREATE TABLE public.purchase_consents (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
version text NOT NULL,
accepted_at timestamp with time zone NOT NULL DEFAULT now(),
ip inet,
user_agent text
);
CREATE TABLE public.rate_limit_logs (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid,
ip text,
endpoint text NOT NULL,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.reports (
id uuid NOT NULL DEFAULT gen_random_uuid(),
reporter_id uuid NOT NULL,
event_id uuid,
target_type text NOT NULL,
target_id uuid NOT NULL,
reason text NOT NULL,
details text,
status text NOT NULL DEFAULT 'open'::text,
resolution text,
resolved_at timestamp with time zone,
resolved_by uuid,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.song_metadata (
id uuid NOT NULL DEFAULT gen_random_uuid(),
normalized_query text NOT NULL,
title text,
artist text,
album text,
duration_ms integer,
explicit boolean NOT NULL DEFAULT false,
album_art_url text,
spotify_url text,
apple_url text,
provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
results jsonb NOT NULL DEFAULT '[]'::jsonb,
cached_at timestamp with time zone NOT NULL DEFAULT now(),
expires_at timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval)
);
CREATE TABLE public.song_requests (
id uuid NOT NULL DEFAULT gen_random_uuid(),
event_id uuid NOT NULL,
requested_by uuid,
requester_name text NOT NULL DEFAULT 'Guest'::text,
title text NOT NULL,
artist text NOT NULL,
album_art text,
external_url text,
status request_status NOT NULL DEFAULT 'pending'::request_status,
boost integer NOT NULL DEFAULT 0,
upvotes integer NOT NULL DEFAULT 0,
downvotes integer NOT NULL DEFAULT 0,
created_at timestamp with time zone NOT NULL DEFAULT now(),
album text,
album_art_url text,
duration_ms integer,
preview_url text,
source_platform text,
source_song_id text,
explicit boolean NOT NULL DEFAULT false,
queue_position double precision,
played_at timestamp with time zone,
played_by_source text
);
CREATE TABLE public.suppressed_emails (
id uuid NOT NULL DEFAULT gen_random_uuid(),
email text NOT NULL,
reason text NOT NULL,
metadata jsonb,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
id uuid NOT NULL DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
role app_role NOT NULL DEFAULT 'guest'::app_role,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE public.votes (
id uuid NOT NULL DEFAULT gen_random_uuid(),
song_request_id uuid NOT NULL,
user_id uuid NOT NULL,
value smallint NOT NULL,
created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_config_pkey ON public.app_config USING btree (key);
CREATE INDEX idx_boost_purchases_user_created ON public.boost_purchases USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX boost_purchases_pkey ON public.boost_purchases USING btree (id);
CREATE INDEX idx_boost_purchases_event ON public.boost_purchases USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE UNIQUE INDEX bridge_pair_attempts_pkey ON public.bridge_pair_attempts USING btree (id);
CREATE INDEX idx_bridge_pair_attempts_ip_time ON public.bridge_pair_attempts USING btree (ip, attempted_at DESC);
CREATE UNIQUE INDEX bridge_pairing_codes_pkey ON public.bridge_pairing_codes USING btree (id);
CREATE INDEX idx_bridge_pairing_codes_event ON public.bridge_pairing_codes USING btree (event_id);
CREATE INDEX idx_bridge_pairing_codes_expires ON public.bridge_pairing_codes USING btree (expires_at);
CREATE UNIQUE INDEX bridge_pairing_codes_code_key ON public.bridge_pairing_codes USING btree (code);
CREATE UNIQUE INDEX dj_payout_accounts_pkey ON public.dj_payout_accounts USING btree (user_id);
CREATE UNIQUE INDEX dj_payout_accounts_stripe_account_id_key ON public.dj_payout_accounts USING btree (stripe_account_id);
CREATE UNIQUE INDEX dj_role_claims_user_success_unique ON public.dj_role_claims USING btree (user_id) WHERE (success = true);
CREATE UNIQUE INDEX dj_role_claims_pkey ON public.dj_role_claims USING btree (id);
CREATE INDEX idx_dj_role_claims_user_time ON public.dj_role_claims USING btree (user_id, attempted_at DESC);
CREATE INDEX dj_tips_user_created_idx ON public.dj_tips USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX dj_tips_stripe_payment_intent_id_key ON public.dj_tips USING btree (stripe_payment_intent_id);
CREATE UNIQUE INDEX dj_tips_stripe_checkout_session_id_key ON public.dj_tips USING btree (stripe_checkout_session_id);
CREATE INDEX idx_dj_tips_stripe_charge_id ON public.dj_tips USING btree (stripe_charge_id) WHERE (stripe_charge_id IS NOT NULL);
CREATE INDEX idx_dj_tips_event_status ON public.dj_tips USING btree (event_id, status);
CREATE INDEX idx_dj_tips_dj_id ON public.dj_tips USING btree (dj_id, created_at DESC);
CREATE UNIQUE INDEX dj_tips_pkey ON public.dj_tips USING btree (id);
CREATE INDEX idx_dj_tips_user_24h ON public.dj_tips USING btree (user_id, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'succeeded'::text]));
CREATE INDEX idx_dj_tips_user_id ON public.dj_tips USING btree (user_id, created_at DESC);
CREATE INDEX dj_tips_status_expires_idx ON public.dj_tips USING btree (status, checkout_expires_at);
CREATE INDEX idx_dj_tips_song_request ON public.dj_tips USING btree (song_request_id);
CREATE INDEX idx_dj_tips_event_id ON public.dj_tips USING btree (event_id, created_at DESC);
CREATE INDEX idx_email_send_log_created ON public.email_send_log USING btree (created_at DESC);
CREATE INDEX idx_email_send_log_message ON public.email_send_log USING btree (message_id);
CREATE INDEX idx_email_send_log_recipient ON public.email_send_log USING btree (recipient_email);
CREATE UNIQUE INDEX email_send_log_pkey ON public.email_send_log USING btree (id);
CREATE UNIQUE INDEX idx_email_send_log_message_sent_unique ON public.email_send_log USING btree (message_id) WHERE (status = 'sent'::text);
CREATE UNIQUE INDEX email_send_state_pkey ON public.email_send_state USING btree (id);
CREATE UNIQUE INDEX email_unsubscribe_tokens_email_key ON public.email_unsubscribe_tokens USING btree (email);
CREATE INDEX idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens USING btree (token);
CREATE UNIQUE INDEX email_unsubscribe_tokens_token_key ON public.email_unsubscribe_tokens USING btree (token);
CREATE UNIQUE INDEX email_unsubscribe_tokens_pkey ON public.email_unsubscribe_tokens USING btree (id);
CREATE UNIQUE INDEX error_logs_pkey ON public.error_logs USING btree (id);
CREATE INDEX idx_error_logs_severity_created ON public.error_logs USING btree (severity, created_at DESC);
CREATE INDEX idx_error_logs_reviewed ON public.error_logs USING btree (reviewed, created_at DESC);
CREATE INDEX idx_event_banned_event ON public.event_banned_guests USING btree (event_id);
CREATE UNIQUE INDEX event_banned_guests_event_id_user_id_key ON public.event_banned_guests USING btree (event_id, user_id);
CREATE UNIQUE INDEX event_banned_guests_pkey ON public.event_banned_guests USING btree (id);
CREATE INDEX idx_event_blocklist_value ON public.event_blocklist USING btree (lower(value));
CREATE INDEX idx_event_blocklist_event ON public.event_blocklist USING btree (event_id);
CREATE UNIQUE INDEX event_blocklist_pkey ON public.event_blocklist USING btree (id);
CREATE UNIQUE INDEX event_integrations_pkey ON public.event_integrations USING btree (id);
CREATE UNIQUE INDEX event_integrations_event_id_source_type_key ON public.event_integrations USING btree (event_id, source_type);
CREATE INDEX event_integrations_token_idx ON public.event_integrations USING btree (ingest_token);
CREATE UNIQUE INDEX event_participants_event_id_user_id_key ON public.event_participants USING btree (event_id, user_id);
CREATE UNIQUE INDEX event_participants_pkey ON public.event_participants USING btree (id);
CREATE INDEX idx_ep_event ON public.event_participants USING btree (event_id);
CREATE INDEX idx_event_participants_user_joined ON public.event_participants USING btree (user_id, joined_at);
CREATE UNIQUE INDEX events_room_code_key ON public.events USING btree (room_code);
CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);
CREATE UNIQUE INDEX guest_funnel_events_pkey ON public.guest_funnel_events USING btree (id);
CREATE INDEX guest_funnel_events_type_idx ON public.guest_funnel_events USING btree (event_type, created_at DESC);
CREATE INDEX guest_funnel_events_user_idx ON public.guest_funnel_events USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX now_playing_event_id_unique ON public.now_playing USING btree (event_id);
CREATE UNIQUE INDEX now_playing_event_id_key ON public.now_playing USING btree (event_id);
CREATE UNIQUE INDEX now_playing_pkey ON public.now_playing USING btree (id);
CREATE INDEX idx_pt_user ON public.points_transactions USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX points_transactions_pkey ON public.points_transactions USING btree (id);
CREATE INDEX idx_pt_event ON public.points_transactions USING btree (event_id, created_at DESC);
CREATE UNIQUE INDEX uniq_starter_points_per_user ON public.points_transactions USING btree (user_id) WHERE (reason = 'Starter points'::text);
CREATE INDEX idx_points_tx_user_created ON public.points_transactions USING btree (user_id, created_at) WHERE (amount > 0);
CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);
CREATE INDEX idx_profiles_is_public ON public.profiles USING btree (is_public) WHERE (is_public = true);
CREATE UNIQUE INDEX purchase_consents_pkey ON public.purchase_consents USING btree (id);
CREATE INDEX purchase_consents_user_idx ON public.purchase_consents USING btree (user_id, accepted_at DESC);
CREATE UNIQUE INDEX purchase_consents_user_id_version_key ON public.purchase_consents USING btree (user_id, version);
CREATE INDEX rate_limit_logs_endpoint_created_idx ON public.rate_limit_logs USING btree (endpoint, created_at DESC);
CREATE INDEX rate_limit_logs_user_created_idx ON public.rate_limit_logs USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX rate_limit_logs_pkey ON public.rate_limit_logs USING btree (id);
CREATE INDEX rate_limit_logs_ip_created_idx ON public.rate_limit_logs USING btree (ip, created_at DESC);
CREATE INDEX reports_reporter_created_idx ON public.reports USING btree (reporter_id, created_at DESC);
CREATE UNIQUE INDEX reports_pkey ON public.reports USING btree (id);
CREATE INDEX reports_event_status_idx ON public.reports USING btree (event_id, status);
CREATE INDEX reports_target_idx ON public.reports USING btree (target_type, target_id);
CREATE INDEX song_metadata_expires_at_idx ON public.song_metadata USING btree (expires_at);
CREATE INDEX song_metadata_provider_ids_idx ON public.song_metadata USING gin (provider_ids);
CREATE INDEX song_metadata_cached_at_idx ON public.song_metadata USING btree (cached_at DESC);
CREATE INDEX song_metadata_normalized_query_idx ON public.song_metadata USING btree (normalized_query);
CREATE INDEX song_metadata_title_trgm_idx ON public.song_metadata USING gin (title gin_trgm_ops);
CREATE UNIQUE INDEX song_metadata_normalized_query_key ON public.song_metadata USING btree (normalized_query);
CREATE UNIQUE INDEX song_metadata_pkey ON public.song_metadata USING btree (id);
CREATE INDEX song_metadata_artist_trgm_idx ON public.song_metadata USING gin (artist gin_trgm_ops);
CREATE UNIQUE INDEX song_requests_unique_active_provider ON public.song_requests USING btree (event_id, lower(btrim(source_platform)), btrim(source_song_id)) WHERE ((status = ANY (ARRAY['pending'::request_status, 'approved'::request_status, 'playing'::request_status])) AND (source_platform IS NOT NULL) AND (btrim(source_platform) <> ''::text) AND (source_song_id IS NOT NULL) AND (btrim(source_song_id) <> ''::text));
CREATE INDEX idx_song_requests_requested_by_created ON public.song_requests USING btree (requested_by, created_at) WHERE (requested_by IS NOT NULL);
CREATE INDEX idx_song_requests_queue_ranking ON public.song_requests USING btree (event_id, status, boost DESC, upvotes DESC);
CREATE INDEX idx_song_requests_event_status ON public.song_requests USING btree (event_id, status);
CREATE INDEX idx_song_requests_event_queue_pos ON public.song_requests USING btree (event_id, queue_position);
CREATE UNIQUE INDEX song_requests_pkey ON public.song_requests USING btree (id);
CREATE INDEX idx_suppressed_emails_email ON public.suppressed_emails USING btree (email);
CREATE UNIQUE INDEX suppressed_emails_email_key ON public.suppressed_emails USING btree (email);
CREATE UNIQUE INDEX suppressed_emails_pkey ON public.suppressed_emails USING btree (id);
CREATE UNIQUE INDEX user_roles_pkey ON public.user_roles USING btree (id);
CREATE UNIQUE INDEX user_roles_user_id_role_key ON public.user_roles USING btree (user_id, role);
CREATE UNIQUE INDEX votes_pkey ON public.votes USING btree (id);
CREATE UNIQUE INDEX votes_song_request_id_user_id_key ON public.votes USING btree (song_request_id, user_id);
CREATE OR REPLACE FUNCTION public.award_points(_user_id uuid, _event_id uuid, _amount integer, _type point_tx_type, _reason text DEFAULT ''::text, _song_request_id uuid DEFAULT NULL::uuid, _created_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if _amount = 0 then return; end if;
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
    set points = greatest(0, points + _amount),
        updated_at = now()
    where id = _user_id;
  perform set_config('app.bypass_profile_guard', 'off', true);
  insert into public.points_transactions (user_id, event_id, song_request_id, amount, type, reason, created_by)
    values (_user_id, _event_id, _song_request_id, _amount, _type, coalesce(_reason, ''), _created_by);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.boost_request(_song_request_id uuid, _amount integer)
 RETURNS song_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _user uuid := auth.uid();
  _req public.song_requests;
  _balance int;
begin
  if _user is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Invalid boost amount' using errcode = '22023'; end if;
  if _amount > 10000 then raise exception 'Boost too large' using errcode = '22023'; end if;

  select * into _req from public.song_requests where id = _song_request_id for update;
  if _req.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;

  if _req.status in ('played'::request_status, 'skipped'::request_status, 'removed'::request_status) then
    raise exception 'Cannot boost this request' using errcode = '22023';
  end if;

  -- Lock + check balance
  select points into _balance from public.profiles where id = _user for update;
  if _balance is null or _balance < _amount then
    raise exception 'Insufficient points' using errcode = 'P0001';
  end if;

  -- Deduct points (records a points_transactions row)
  perform public.award_points(
    _user, _req.event_id, -_amount,
    'spent'::public.point_tx_type,
    'Boost (credits)', _song_request_id, null
  );

  -- Increase boost
  update public.song_requests
    set boost = boost + _amount
    where id = _song_request_id
    returning * into _req;

  return _req;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_boost_purchase_cap(_user_id uuid, _event_id uuid, _amount_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _max_single_cents constant int := 5000;   -- $50 single tip
  _max_24h_cents    constant int := 10000;  -- $100 / rolling 24h
  _max_event_cents  constant int := 10000;  -- $100 / event / user
  _spent_24h int;
  _spent_event int;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'User required' USING ERRCODE = '22023';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RAISE EXCEPTION 'Invalid purchase amount' USING ERRCODE = '22023';
  END IF;
  IF _amount_cents > _max_single_cents THEN
    RAISE EXCEPTION 'Purchase exceeds the $50 single-purchase limit' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO _spent_24h
  FROM public.boost_purchases
  WHERE user_id = _user_id
    AND status IN ('pending','succeeded')
    AND created_at > now() - interval '24 hours';

  IF _spent_24h + _amount_cents > _max_24h_cents THEN
    RAISE EXCEPTION 'Daily tip limit reached ($100 / 24h)' USING ERRCODE = '22023';
  END IF;

  IF _event_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_cents), 0) INTO _spent_event
    FROM public.boost_purchases
    WHERE user_id = _user_id
      AND event_id = _event_id
      AND status IN ('pending','succeeded');
    IF _spent_event + _amount_cents > _max_event_cents THEN
      RAISE EXCEPTION 'Per-event tip limit reached ($100 / event)' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.check_tip_cap(_user_id uuid, _event_id uuid, _amount_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _max_single_cents constant int := 5000;   -- $50 single
  _max_24h_cents    constant int := 10000;  -- $100 / 24h
  _max_event_cents  constant int := 10000;  -- $100 / event / user
  _spent_24h int;
  _spent_event int;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'User required' USING ERRCODE = '22023';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RAISE EXCEPTION 'Invalid tip amount' USING ERRCODE = '22023';
  END IF;
  IF _amount_cents > _max_single_cents THEN
    RAISE EXCEPTION 'Tip exceeds $50 single-tip limit' USING ERRCODE = '22023';
  END IF;

  -- 24h cap: succeeded tips created in the last 24h, plus unexpired pending tips.
  SELECT COALESCE(SUM(gross_amount_cents),0) INTO _spent_24h
  FROM public.dj_tips
  WHERE user_id = _user_id
    AND (
      (status = 'succeeded' AND created_at > now() - interval '24 hours')
      OR public.tip_pending_is_live(status, checkout_expires_at, created_at)
    );
  IF _spent_24h + _amount_cents > _max_24h_cents THEN
    RAISE EXCEPTION 'Daily tip limit reached ($100 / 24h)' USING ERRCODE = '22023';
  END IF;

  -- Event cap: all succeeded tips for that event, plus unexpired pending tips.
  IF _event_id IS NOT NULL THEN
    SELECT COALESCE(SUM(gross_amount_cents),0) INTO _spent_event
    FROM public.dj_tips
    WHERE user_id = _user_id
      AND event_id = _event_id
      AND (
        status = 'succeeded'
        OR public.tip_pending_is_live(status, checkout_expires_at, created_at)
      );
    IF _spent_event + _amount_cents > _max_event_cents THEN
      RAISE EXCEPTION 'Per-event tip limit reached ($100 / event)' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_dj_role()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _recent int;
  _already boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Idempotent: if already DJ, no-op
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'dj')
    INTO _already;
  IF _already THEN RETURN; END IF;

  -- Rate limit: max 5 claim attempts per user per hour
  SELECT count(*) INTO _recent
  FROM public.dj_role_claims
  WHERE user_id = _uid
    AND attempted_at > now() - interval '1 hour';
  IF _recent >= 5 THEN
    INSERT INTO public.dj_role_claims (user_id, success) VALUES (_uid, false);
    RAISE EXCEPTION 'Too many DJ claim attempts. Try again later.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
    VALUES (_uid, 'dj') ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.dj_role_claims (user_id, success) VALUES (_uid, true);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.create_event(_name text, _venue text DEFAULT NULL::text, _dj_name text DEFAULT NULL::text, _allow_explicit boolean DEFAULT true, _require_approval boolean DEFAULT false, _cooldown_seconds integer DEFAULT 0, _rules_text text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, room_code text, name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  _code text;
  _bytes bytea;
  _i int;
  _attempt int := 0;
  _row public.events;
  _clean_name text;
  _clean_dj text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(_uid, 'dj'::public.app_role) THEN
    RAISE EXCEPTION 'not_a_dj' USING ERRCODE = '42501';
  END IF;

  _clean_name := nullif(btrim(coalesce(_name, '')), '');
  IF _clean_name IS NULL OR length(_clean_name) > 80 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;

  _clean_dj := nullif(btrim(coalesce(_dj_name, '')), '');
  IF _clean_dj IS NULL THEN
    SELECT p.nickname INTO _clean_dj FROM public.profiles p WHERE p.id = _uid;
    _clean_dj := coalesce(nullif(btrim(coalesce(_clean_dj, '')), ''), 'DJ');
  END IF;
  IF length(_clean_dj) > 60 THEN
    RAISE EXCEPTION 'invalid_dj_name' USING ERRCODE = '22023';
  END IF;

  IF _cooldown_seconds IS NULL OR _cooldown_seconds < 0 OR _cooldown_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid_cooldown' USING ERRCODE = '22023';
  END IF;

  LOOP
    _attempt := _attempt + 1;
    _bytes := extensions.gen_random_bytes(6);
    _code := '';
    FOR _i IN 0..5 LOOP
      _code := _code || substr(_alphabet, (get_byte(_bytes, _i) % 32) + 1, 1);
    END LOOP;

    BEGIN
      INSERT INTO public.events (
        dj_id, name, venue, dj_name, room_code, is_active,
        allow_explicit, require_approval, cooldown_seconds, rules_text
      )
      VALUES (
        _uid, _clean_name, nullif(btrim(coalesce(_venue, '')), ''), _clean_dj, _code, true,
        coalesce(_allow_explicit, true), coalesce(_require_approval, false),
        _cooldown_seconds, nullif(btrim(coalesce(_rules_text, '')), '')
      )
      RETURNING * INTO _row;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF _attempt >= 10 THEN
        RAISE EXCEPTION 'could_not_allocate_room_code' USING ERRCODE = '55000';
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT _row.id, _row.room_code, _row.name, _row.created_at;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.email_queue_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN RETURN; END; $function$
;
CREATE OR REPLACE FUNCTION public.email_queue_wake()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN RETURN NULL; END; $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_profile(p_nickname text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid  uuid := auth.uid();
  _nick text;
  _p    public.profiles;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  _nick := nullif(btrim(coalesce(p_nickname, '')), '');
  IF _nick IS NULL THEN
    RAISE EXCEPTION 'nickname_required';
  END IF;
  IF length(_nick) < 2 OR length(_nick) > 24 THEN
    RAISE EXCEPTION 'nickname_length';
  END IF;

  -- Bypass the protect_profile_sensitive_columns guard so the nickname
  -- update lands even when called outside the usual client path.
  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  INSERT INTO public.profiles (id, nickname, points)
  VALUES (_uid, _nick, 15)
  ON CONFLICT (id) DO UPDATE
    SET nickname   = EXCLUDED.nickname,
        updated_at = now()
  RETURNING * INTO _p;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  -- Make sure the guest role exists too (handle_new_user normally does this,
  -- but we guard against the same trigger gap).
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'guest')
  ON CONFLICT (user_id, role) DO NOTHING;

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
CREATE OR REPLACE FUNCTION public.generate_bridge_pairing_code(_event_id uuid)
 RETURNS TABLE(code text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
  _code text;
  _expires timestamptz := now() + interval '5 minutes';
  _attempts int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.events WHERE id = _event_id AND dj_id = _uid) INTO _is_owner;
  IF NOT _is_owner THEN RAISE EXCEPTION 'Not the DJ for this event'; END IF;

  -- Ensure integration row exists
  INSERT INTO public.event_integrations (event_id, source_type)
  SELECT _event_id, 'bridge'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_integrations ei WHERE ei.event_id = _event_id);

  -- Invalidate any prior unclaimed codes for this event
  DELETE FROM public.bridge_pairing_codes bpc
    WHERE bpc.event_id = _event_id AND bpc.claimed_at IS NULL;

  -- Cleanup expired codes globally
  DELETE FROM public.bridge_pairing_codes bpc
    WHERE bpc.expires_at < now() - interval '1 hour';

  LOOP
    _attempts := _attempts + 1;
    _code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    BEGIN
      INSERT INTO public.bridge_pairing_codes (code, event_id, created_by, expires_at)
        VALUES (_code, _event_id, _uid, _expires);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF _attempts > 8 THEN RAISE EXCEPTION 'Could not allocate pairing code'; END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT _code, _expires;
END;
$function$
;
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
CREATE OR REPLACE FUNCTION public.get_guest_join_limits()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT value FROM public.app_config WHERE key = 'guest_join_limits'
$function$
;
CREATE OR REPLACE FUNCTION public.get_ingest_token(_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
  _token text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.events WHERE id = _event_id AND dj_id = _uid) INTO _is_owner;
  IF NOT _is_owner THEN
    RAISE EXCEPTION 'Not the DJ for this event';
  END IF;

  SELECT ingest_token INTO _token
  FROM public.event_integrations
  WHERE event_id = _event_id;

  IF _token IS NULL THEN
    INSERT INTO public.event_integrations (event_id, source_type)
    VALUES (_event_id, 'manual')
    ON CONFLICT DO NOTHING;
    SELECT ingest_token INTO _token
    FROM public.event_integrations
    WHERE event_id = _event_id;
  END IF;

  RETURN _token;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _p public.profiles;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _uid;
  IF _p.id IS NULL THEN RETURN NULL; END IF;
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
CREATE OR REPLACE FUNCTION public.get_nickname(_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT nickname FROM public.profiles WHERE id = _user_id
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_nicknames(_user_ids uuid[])
 RETURNS TABLE(id uuid, nickname text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _ids uuid[];
BEGIN
  IF _user_ids IS NULL OR array_length(_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT u) INTO _ids
  FROM unnest(_user_ids) AS u
  WHERE u IS NOT NULL;

  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  IF array_length(_ids, 1) > 500 THEN
    RAISE EXCEPTION 'too_many_ids: maximum 500 user ids per request'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT p.id, p.nickname
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_profile(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.profiles;
  _is_dj boolean;
  _requests int := 0;
  _upvotes int := 0;
  _downvotes int := 0;
  _boosts int := 0;
  _events int := 0;
  _top jsonb := NULL;
  _recent jsonb := '[]'::jsonb;
  _rank int := NULL;
BEGIN
  SELECT * INTO _p FROM public.profiles WHERE id = _user_id;
  IF _p.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'dj') INTO _is_dj;

  IF _p.is_public = false AND (auth.uid() IS NULL OR auth.uid() <> _user_id) THEN
    RETURN jsonb_build_object(
      'found', true,
      'is_public', false,
      'nickname', _p.nickname,
      'is_dj', _is_dj
    );
  END IF;

  SELECT
    count(*),
    coalesce(sum(upvotes),0),
    coalesce(sum(downvotes),0),
    coalesce(sum(boost),0)
  INTO _requests, _upvotes, _downvotes, _boosts
  FROM public.song_requests WHERE requested_by = _user_id;

  SELECT count(DISTINCT event_id) INTO _events
  FROM public.event_participants WHERE user_id = _user_id;

  SELECT to_jsonb(t) INTO _top FROM (
    SELECT id, title, artist, album_art, upvotes, downvotes, boost
    FROM public.song_requests
    WHERE requested_by = _user_id
    ORDER BY (upvotes - downvotes + boost) DESC, created_at DESC
    LIMIT 1
  ) t;

  SELECT coalesce(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO _recent FROM (
    SELECT id, title, artist, album_art, upvotes, downvotes, boost, status::text, created_at, event_id
    FROM public.song_requests
    WHERE requested_by = _user_id
    ORDER BY created_at DESC
    LIMIT 10
  ) t;

  SELECT 1 + count(*) INTO _rank
  FROM public.profiles WHERE points > _p.points AND is_public = true;

  RETURN jsonb_build_object(
    'found', true,
    'is_public', true,
    'user_id', _p.id,
    'nickname', _p.nickname,
    'points', _p.points,
    'is_dj', _is_dj,
    'rank', _rank,
    'created_at', _p.created_at,
    'total_requests', _requests,
    'total_upvotes', _upvotes,
    'total_downvotes', _downvotes,
    'total_boosts', _boosts,
    'events_joined', _events,
    'top_song', _top,
    'recent_songs', _recent
  );
END;
$function$
;
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
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$function$
;
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
CREATE OR REPLACE FUNCTION public.is_event_owner(_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _event_id AND e.dj_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.join_event_by_code(_code text, _nickname text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _norm text;
  _ev public.events;
  _nick text;
  _denied constant jsonb := jsonb_build_object('ok', false, 'reason', 'unavailable');
BEGIN
  IF _uid IS NULL THEN
    RETURN _denied;
  END IF;

  _norm := upper(regexp_replace(coalesce(_code, ''), '\s+', '', 'g'));
  IF _norm !~ '^[A-Z0-9]{5,10}$' THEN
    RETURN _denied;
  END IF;

  SELECT * INTO _ev FROM public.events e WHERE e.room_code = _norm;
  IF _ev.id IS NULL OR _ev.is_active IS NOT TRUE OR _ev.requests_status = 'ended' THEN
    RETURN _denied;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_banned_guests b
    WHERE b.event_id = _ev.id AND b.user_id = _uid
  ) THEN
    RETURN _denied;
  END IF;

  _nick := nullif(btrim(coalesce(_nickname, '')), '');
  IF _nick IS NULL THEN
    SELECT p.nickname INTO _nick FROM public.profiles p WHERE p.id = _uid;
  END IF;
  _nick := coalesce(nullif(btrim(coalesce(_nick, '')), ''), 'Guest');
  IF length(_nick) > 24 THEN
    _nick := substr(_nick, 1, 24);
  END IF;

  INSERT INTO public.event_participants (event_id, user_id, nickname)
  VALUES (_ev.id, _uid, _nick)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET last_seen_at = now(), nickname = EXCLUDED.nickname;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'id', _ev.id,
      'name', _ev.name,
      'venue', _ev.venue,
      'dj_name', _ev.dj_name,
      'room_code', _ev.room_code,
      'requests_status', _ev.requests_status,
      'allow_explicit', _ev.allow_explicit,
      'require_approval', _ev.require_approval,
      'cooldown_seconds', _ev.cooldown_seconds,
      'rules_text', _ev.rules_text
    )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.normalize_text(_t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT regexp_replace(lower(coalesce(_t, '')), '[^a-z0-9]+', '', 'g')
$function$
;
CREATE OR REPLACE FUNCTION public.on_event_join()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.award_points(new.user_id, new.event_id, 1, 'earned', 'Joined event', null, null);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.on_song_request_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.requested_by is not null then
    perform public.award_points(new.requested_by, new.event_id, 1, 'earned', 'Song requested', new.id, null);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.on_song_request_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Points for tracks played are disabled.
  -- DJ decisions should not affect a requester's point balance.
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.on_vote_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Points for upvotes received are disabled.
  -- Vote counts are still maintained by sync_vote_counts trigger.
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted RPCs (award_points/boost_request/etc.) set this flag before mutating points
  IF current_setting('app.bypass_profile_guard', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Internal/service contexts (no auth.uid)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- End-user updates: lock sensitive fields
  IF auth.uid() = OLD.id THEN
    NEW.id := OLD.id;
    NEW.points := OLD.points;
    NEW.is_premium := OLD.is_premium;
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
 RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$function$
;
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
CREATE OR REPLACE FUNCTION public.regenerate_ingest_token(_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.events WHERE id = _event_id AND dj_id = _uid) INTO _is_owner;
  IF NOT _is_owner THEN RAISE EXCEPTION 'Not the DJ for this event'; END IF;

  INSERT INTO public.event_integrations (event_id, source_type, ingest_token)
    VALUES (_event_id, 'bridge', encode(extensions.gen_random_bytes(24), 'hex'))
    ON CONFLICT DO NOTHING;

  UPDATE public.event_integrations
    SET ingest_token = encode(extensions.gen_random_bytes(24), 'hex'),
        updated_at = now()
    WHERE event_id = _event_id;

  -- Invalidate all pairing codes for this event
  DELETE FROM public.bridge_pairing_codes WHERE event_id = _event_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.remove_my_song_request(_song_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _req public.song_requests;
  _earned int := 0;
  _spent int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _req FROM public.song_requests WHERE id = _song_request_id FOR UPDATE;
  IF _req.id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF _req.requested_by IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'You can only remove your own requests';
  END IF;

  IF _req.status <> 'pending'::request_status THEN
    RAISE EXCEPTION 'This request can''t be removed anymore';
  END IF;

  -- Refund positive earnings tied to this request
  SELECT COALESCE(SUM(pt.amount), 0) INTO _earned
  FROM public.points_transactions pt
  WHERE pt.song_request_id = _song_request_id
    AND pt.user_id = _uid
    AND pt.amount > 0;

  IF _earned > 0 THEN
    PERFORM public.award_points(
      _uid, _req.event_id, -_earned,
      'refunded'::public.point_tx_type,
      'Request removed by user',
      _song_request_id, _uid
    );
  END IF;

  -- Refund boost spend (negative transactions tied to this request)
  SELECT COALESCE(-SUM(pt.amount), 0) INTO _spent
  FROM public.points_transactions pt
  WHERE pt.song_request_id = _song_request_id
    AND pt.user_id = _uid
    AND pt.amount < 0
    AND pt.type = 'spent';

  IF _spent > 0 THEN
    PERFORM public.award_points(
      _uid, _req.event_id, _spent,
      'refunded'::public.point_tx_type,
      'Boost refunded (request removed)',
      _song_request_id, _uid
    );
  END IF;

  -- Soft-delete: keep row so cooldown still applies
  UPDATE public.song_requests
    SET status = 'removed'::request_status
    WHERE id = _song_request_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reports_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _recent int;
BEGIN
  SELECT count(*) INTO _recent
  FROM public.reports
  WHERE reporter_id = NEW.reporter_id
    AND created_at > now() - interval '1 hour';
  IF _recent >= 10 THEN
    RAISE EXCEPTION 'Too many reports. Please try again later.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reports_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('resolved','dismissed') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.resolved_at := now();
    NEW.resolved_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.request_song(_event_id uuid, _source_platform text, _source_song_id text, _title text, _artist text, _album text DEFAULT NULL::text, _album_art_url text DEFAULT NULL::text, _duration_ms integer DEFAULT NULL::integer, _preview_url text DEFAULT NULL::text, _explicit boolean DEFAULT false, _external_url text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, request_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _plat text;
  _sid text;
  _title_c text;
  _artist_c text;
  _ev public.events%rowtype;
  _existing public.song_requests%rowtype;
  _vote_value smallint;
  _new_id uuid;
  _nickname text := 'Guest';
  _attempt int := 0;
begin
  if _uid is null then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  -- Provider normalization -------------------------------------------------
  _plat := lower(btrim(coalesce(_source_platform, '')));
  if _plat in ('apple_music', 'itunes') then
    _plat := 'itunes';
  end if;
  _sid := btrim(coalesce(_source_song_id, ''));

  if _plat = 'spotify' then
    if _sid ~ '^[A-Za-z0-9]{22}$' then
      null;
    elsif _sid ~ '^spotify:track:[A-Za-z0-9]{22}$' then
      _sid := substring(_sid from 'spotify:track:([A-Za-z0-9]{22})$');
    elsif _sid ~ '^https?://open\.spotify\.com/track/[A-Za-z0-9]{22}([/?#].*)?$' then
      _sid := substring(_sid from 'track/([A-Za-z0-9]{22})');
    else
      return query select 'invalid_track'::text, null::uuid;
      return;
    end if;
  elsif _plat = 'itunes' then
    if _sid !~ '^[0-9]+$' then
      return query select 'invalid_track'::text, null::uuid;
      return;
    end if;
  else
    return query select 'invalid_track'::text, null::uuid;
    return;
  end if;

  _title_c := btrim(coalesce(_title, ''));
  _artist_c := btrim(coalesce(_artist, ''));
  if _title_c = '' or _artist_c = '' then
    return query select 'invalid_track'::text, null::uuid;
    return;
  end if;

  -- Event state + authorization -------------------------------------------
  select * into _ev from public.events e where e.id = _event_id for update;
  if not found then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  if _ev.dj_id <> _uid then
    if not exists (
      select 1 from public.event_participants p
      where p.event_id = _event_id and p.user_id = _uid
    ) or exists (
      select 1 from public.event_banned_guests b
      where b.event_id = _event_id and b.user_id = _uid
    ) then
      return query select 'unavailable'::text, null::uuid;
      return;
    end if;
  end if;

  -- Every non-usable event state collapses into the SAME generic outcome so the
  -- response never reveals whether an event exists, is ended, paused, inactive,
  -- or simply inaccessible to this caller.
  if not _ev.is_active
     or _ev.ended_at is not null
     or _ev.requests_status <> 'live' then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  if coalesce(_explicit, false) and not _ev.allow_explicit then
    return query select 'explicit_not_allowed'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.event_blocklist bl
    where bl.event_id = _event_id
      and (
        (bl.kind = 'artist' and public.normalize_text(bl.value) = public.normalize_text(_artist_c))
        or (bl.kind = 'song' and public.normalize_text(bl.value) = public.normalize_text(_title_c))
        or (bl.kind = 'keyword' and (
             public.normalize_text(_title_c) like '%' || public.normalize_text(bl.value) || '%'
             or public.normalize_text(_artist_c) like '%' || public.normalize_text(bl.value) || '%'
           ))
      )
  ) then
    return query select 'blocked'::text, null::uuid;
    return;
  end if;

  -- Find-or-create ---------------------------------------------------------
  loop
    _attempt := _attempt + 1;

    select * into _existing
    from public.song_requests sr
    where sr.event_id = _event_id
      and sr.status in ('pending', 'approved', 'playing')
      and lower(btrim(sr.source_platform)) = _plat
      and btrim(sr.source_song_id) = _sid
    limit 1
    for update;

    if found then
      select v.value into _vote_value
      from public.votes v
      where v.song_request_id = _existing.id and v.user_id = _uid
      for update;

      if not found then
        insert into public.votes (song_request_id, user_id, value)
        values (_existing.id, _uid, 1)
        on conflict (song_request_id, user_id) do update set value = 1;
        return query select 'supported_existing'::text, _existing.id;
      elsif _vote_value = 1 then
        return query select 'already_supported'::text, _existing.id;
      else
        update public.votes v set value = 1
        where v.song_request_id = _existing.id and v.user_id = _uid;
        return query select 'supported_existing'::text, _existing.id;
      end if;
      return;
    end if;

    if _attempt = 1 then
      -- Serialize this caller's new-request path for this event, then re-check.
      perform pg_advisory_xact_lock(hashtextextended(_uid::text || ':' || _event_id::text, 0));
      continue;
    end if;

    if _attempt > 4 then
      raise exception 'request_song could not resolve a concurrent duplicate; please retry'
        using errcode = '40001';
    end if;

    if _attempt = 2 then
      -- Cooldown applies only to genuinely new requests.
      if coalesce(_ev.cooldown_seconds, 0) > 0
         and public.recent_request_count(_event_id, _ev.cooldown_seconds) > 0 then
        return query select 'cooldown'::text, null::uuid;
        return;
      end if;

      select p.nickname into _nickname from public.profiles p where p.id = _uid;
      _nickname := coalesce(nullif(btrim(coalesce(_nickname, '')), ''), 'Guest');
    end if;

    insert into public.song_requests (
      event_id, requested_by, requester_name, title, artist,
      album, album_art, album_art_url, duration_ms, preview_url,
      explicit, source_platform, source_song_id, external_url
    )
    values (
      _event_id, _uid, _nickname, _title_c, _artist_c,
      _album, _album_art_url, _album_art_url, _duration_ms, _preview_url,
      coalesce(_explicit, false), _plat, _sid,
      nullif(btrim(coalesce(_external_url, '')), '')
    )
    on conflict (event_id, lower(btrim(source_platform)), btrim(source_song_id))
      where status in ('pending', 'approved', 'playing')
        and source_platform is not null
        and btrim(source_platform) <> ''
        and source_song_id is not null
        and btrim(source_song_id) <> ''
    do nothing
    returning id into _new_id;

    if _new_id is not null then
      insert into public.votes (song_request_id, user_id, value)
      values (_new_id, _uid, 1)
      on conflict (song_request_id, user_id) do update set value = 1;
      return query select 'created'::text, _new_id;
      return;
    end if;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_event_ended_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.requests_status = 'ended' AND (OLD.requests_status IS DISTINCT FROM 'ended') THEN
    NEW.ended_at := now();
  ELSIF NEW.requests_status <> 'ended' THEN
    NEW.ended_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.song_requests_identity_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.id is distinct from old.id
     or new.event_id is distinct from old.event_id
     or new.requested_by is distinct from old.requested_by
     or new.source_platform is distinct from old.source_platform
     or new.source_song_id is distinct from old.source_song_id
     or new.created_at is distinct from old.created_at then
    raise exception 'song_request identity columns are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_event_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.requests_status = 'ended' then
    new.is_active := false;
  elsif old.requests_status = 'ended' and new.requests_status <> 'ended' then
    new.is_active := true;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_vote_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid;
begin
  target_id := coalesce(new.song_request_id, old.song_request_id);
  update public.song_requests sr
  set
    upvotes = (select count(*) from public.votes v where v.song_request_id = target_id and v.value = 1),
    downvotes = (select count(*) from public.votes v where v.song_request_id = target_id and v.value = -1)
  where sr.id = target_id;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tip_pending_is_live(_status text, _checkout_expires_at timestamp with time zone, _created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT _status = 'pending'
     AND COALESCE(_checkout_expires_at, _created_at + interval '24 hours') > now();
$function$
;
CREATE OR REPLACE FUNCTION public.tip_reconciliation_preview()
 RETURNS TABLE(bucket text, tip_count bigint, total_cents bigint, oldest timestamp with time zone, newest timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN public.tip_pending_is_live(status, checkout_expires_at, created_at) THEN 'pending_live'
      ELSE 'pending_stale_candidate'
    END AS bucket,
    count(*), COALESCE(SUM(gross_amount_cents),0)::bigint, min(created_at), max(created_at)
  FROM public.dj_tips
  WHERE status = 'pending'
  GROUP BY 1
$function$
;
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
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.upgrade_anonymous_profile(p_nickname text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid  uuid := auth.uid();
  _nick text;
  _p    public.profiles;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  _nick := nullif(btrim(coalesce(p_nickname, '')), '');
  IF _nick IS NOT NULL THEN
    IF length(_nick) < 2 OR length(_nick) > 24 THEN
      RAISE EXCEPTION 'nickname_length';
    END IF;
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF _nick IS NOT NULL THEN
    INSERT INTO public.profiles (id, nickname, points)
    VALUES (_uid, _nick, 15)
    ON CONFLICT (id) DO UPDATE
      SET nickname   = EXCLUDED.nickname,
          updated_at = now()
    RETURNING * INTO _p;
  ELSE
    INSERT INTO public.profiles (id, nickname, points)
    VALUES (_uid, 'Guest', 15)
    ON CONFLICT (id) DO UPDATE
      SET updated_at = now()
    RETURNING * INTO _p;
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'guest')
  ON CONFLICT (user_id, role) DO NOTHING;

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
CREATE TRIGGER trg_boost_purchases_updated BEFORE UPDATE ON public.boost_purchases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_dj_payout_accounts_updated_at BEFORE UPDATE ON public.dj_payout_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_dj_tips_updated_at BEFORE UPDATE ON public.dj_tips FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER event_integrations_updated_at BEFORE UPDATE ON public.event_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_event_join AFTER INSERT ON public.event_participants FOR EACH ROW EXECUTE FUNCTION on_event_join();
CREATE TRIGGER trg_sync_event_active BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION sync_event_active();
CREATE TRIGGER trg_set_event_ended_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION set_event_ended_at();
CREATE TRIGGER protect_profile_sensitive_columns BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_sensitive_columns();
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_reports_before_update BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION reports_before_update();
CREATE TRIGGER trg_reports_before_insert BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION reports_before_insert();
CREATE TRIGGER trg_song_requests_identity_immutable BEFORE UPDATE ON public.song_requests FOR EACH ROW EXECUTE FUNCTION song_requests_identity_immutable();
CREATE TRIGGER trg_song_request_status AFTER UPDATE OF status ON public.song_requests FOR EACH ROW EXECUTE FUNCTION on_song_request_status_change();
CREATE TRIGGER trg_song_request_insert AFTER INSERT ON public.song_requests FOR EACH ROW EXECUTE FUNCTION on_song_request_insert();
CREATE TRIGGER trg_vote_change_points AFTER INSERT OR DELETE OR UPDATE ON public.votes FOR EACH ROW EXECUTE FUNCTION on_vote_change();
CREATE TRIGGER votes_sync_after AFTER INSERT OR DELETE OR UPDATE ON public.votes FOR EACH ROW EXECUTE FUNCTION sync_vote_counts();
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_pair_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_role_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_banned_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.now_playing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_config readable by everyone" ON public.app_config FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY "Admins view all purchases" ON public.boost_purchases FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Event DJs view event purchases" ON public.boost_purchases FOR SELECT TO authenticated USING (((event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = boost_purchases.event_id) AND (e.dj_id = auth.uid()))))));
CREATE POLICY "Users view own purchases" ON public.boost_purchases FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "No client access to bridge_pair_attempts" ON public.bridge_pair_attempts FOR ALL TO anon,authenticated USING (false) WITH CHECK (false);
CREATE POLICY "DJ deletes own pairing codes" ON public.bridge_pairing_codes FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = bridge_pairing_codes.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ views own pairing codes" ON public.bridge_pairing_codes FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = bridge_pairing_codes.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "No client inserts (RPC only)" ON public.bridge_pairing_codes FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "DJ reads own payout account" ON public.dj_payout_accounts FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users view own claims" ON public.dj_role_claims FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "DJ sees received tips" ON public.dj_tips FOR SELECT TO authenticated USING ((dj_id = auth.uid()));
CREATE POLICY "Tipper sees own tips" ON public.dj_tips FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT TO public WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT TO public USING ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE TO public USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can manage send state" ON public.email_send_state FOR ALL TO public USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT TO public WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE TO public USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT TO public USING ((auth.role() = 'service_role'::text));
CREATE POLICY "Admins update error logs" ON public.error_logs FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users insert their own error logs" ON public.error_logs FOR INSERT TO authenticated WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));
CREATE POLICY "Owners or admins view error logs" ON public.error_logs FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "DJ deletes bans" ON public.event_banned_guests FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_banned_guests.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ inserts bans" ON public.event_banned_guests FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_banned_guests.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ views bans" ON public.event_banned_guests FOR SELECT TO public USING (((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_banned_guests.event_id) AND (e.dj_id = auth.uid())))) OR (auth.uid() = user_id)));
CREATE POLICY "DJ manages blocklist delete" ON public.event_blocklist FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_blocklist.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ manages blocklist insert" ON public.event_blocklist FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_blocklist.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ views their blocklist" ON public.event_blocklist FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_blocklist.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ deletes integrations" ON public.event_integrations FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_integrations.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ inserts integrations" ON public.event_integrations FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_integrations.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ updates integrations" ON public.event_integrations FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_integrations.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ views integrations" ON public.event_integrations FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_integrations.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ views participants of their events" ON public.event_participants FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_participants.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "Users insert their own participation" ON public.event_participants FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users view their own participation" ON public.event_participants FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "DJs can create events" ON public.events FOR INSERT TO authenticated WITH CHECK (((auth.uid() = dj_id) AND has_role(auth.uid(), 'dj'::app_role)));
CREATE POLICY "DJs delete their own events" ON public.events FOR DELETE TO public USING ((auth.uid() = dj_id));
CREATE POLICY "DJs manage their own events" ON public.events FOR UPDATE TO public USING ((auth.uid() = dj_id));
CREATE POLICY events_select_member ON public.events FOR SELECT TO authenticated USING (is_event_member(id));
CREATE POLICY events_select_owner ON public.events FOR SELECT TO authenticated USING ((dj_id = auth.uid()));
CREATE POLICY "Admins can view funnel events" ON public.guest_funnel_events FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'dj'::app_role)));
CREATE POLICY "Users can insert their own funnel events" ON public.guest_funnel_events FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "DJ can delete now playing" ON public.now_playing FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = now_playing.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ can insert now playing" ON public.now_playing FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = now_playing.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ can update now playing" ON public.now_playing FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = now_playing.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY now_playing_select_scoped ON public.now_playing FOR SELECT TO authenticated USING ((is_event_owner(event_id) OR is_event_member(event_id)));
CREATE POLICY "DJ views transactions for their event" ON public.points_transactions FOR SELECT TO public USING (((event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = points_transactions.event_id) AND (e.dj_id = auth.uid()))))));
CREATE POLICY "Users view their own transactions" ON public.points_transactions FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users view their own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));
CREATE POLICY "Admins view all consents" ON public.purchase_consents FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users insert own consents" ON public.purchase_consents FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users view own consents" ON public.purchase_consents FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "service role only" ON public.rate_limit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins update reports" ON public.reports FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins view all reports" ON public.reports FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated insert own reports" ON public.reports FOR INSERT TO authenticated WITH CHECK ((reporter_id = auth.uid()));
CREATE POLICY "Event DJs update event reports" ON public.reports FOR UPDATE TO authenticated USING (((event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = reports.event_id) AND (e.dj_id = auth.uid()))))));
CREATE POLICY "Event DJs view event reports" ON public.reports FOR SELECT TO authenticated USING (((event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = reports.event_id) AND (e.dj_id = auth.uid()))))));
CREATE POLICY "Reporters view own reports" ON public.reports FOR SELECT TO authenticated USING ((reporter_id = auth.uid()));
CREATE POLICY "service role only" ON public.song_metadata FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "DJ owners can delete song requests" ON public.song_requests FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = song_requests.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "DJ owners can update song requests" ON public.song_requests FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = song_requests.event_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "Users can delete their own pending requests" ON public.song_requests FOR DELETE TO authenticated USING (((auth.uid() = requested_by) AND (status = 'pending'::request_status)));
CREATE POLICY "Users can soft-remove their own pending requests" ON public.song_requests FOR UPDATE TO authenticated USING (((auth.uid() = requested_by) AND (status = 'pending'::request_status))) WITH CHECK (((auth.uid() = requested_by) AND (status = ANY (ARRAY['pending'::request_status, 'removed'::request_status]))));
CREATE POLICY song_requests_select_scoped ON public.song_requests FOR SELECT TO authenticated USING ((is_event_owner(event_id) OR is_event_member(event_id)));
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT TO public WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT TO public USING ((auth.role() = 'service_role'::text));
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "DJ views votes for their events" ON public.votes FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM (song_requests sr
     JOIN events e ON ((e.id = sr.event_id)))
  WHERE ((sr.id = votes.song_request_id) AND (e.dj_id = auth.uid())))));
CREATE POLICY "Users view their own votes" ON public.votes FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY votes_delete_scoped ON public.votes FOR DELETE TO authenticated USING (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM song_requests sr
  WHERE ((sr.id = votes.song_request_id) AND (is_event_owner(sr.event_id) OR is_event_member(sr.event_id)))))));
CREATE POLICY votes_insert_scoped ON public.votes FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM song_requests sr
  WHERE ((sr.id = votes.song_request_id) AND (is_event_owner(sr.event_id) OR is_event_member(sr.event_id)))))));
CREATE POLICY votes_update_scoped ON public.votes FOR UPDATE TO authenticated USING (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM song_requests sr
  WHERE ((sr.id = votes.song_request_id) AND (is_event_owner(sr.event_id) OR is_event_member(sr.event_id))))))) WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM song_requests sr
  WHERE ((sr.id = votes.song_request_id) AND (is_event_owner(sr.event_id) OR is_event_member(sr.event_id)))))));
