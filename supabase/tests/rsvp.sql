-- Plain-SQL checks in the style of pgTAP. No pgTAP extension is required.
-- This file is not part of the migration and is not applied automatically.
--
-- Against a throwaway database:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261011162500_rsvp_mvp.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261011203000_admin_lockout_per_caller.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/seed.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rsvp.sql
--
-- Every change is rolled back.

begin;

-- Keep the success-path checks independent of the sample deadline.
update public.wedding
set rsvp_deadline = '2099-01-01T00:00:00Z'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

do $$
declare
  v jsonb;
  txt text;
  before_count integer;
  after_count integer;
  other_name text;
  payload jsonb;
  i integer;
  v_started timestamptz;
begin
  if public.get_invite(null) is not null then
    raise exception 'null token leaked a result';
  end if;
  if public.get_invite('short') is not null then
    raise exception 'short token leaked a result';
  end if;
  if public.get_invite('not-a-real-invite-token') is not null then
    raise exception 'unknown token leaked a result';
  end if;

  v := public.get_invite('K7mQ2pL9xR4nW8vT3cY6hJd');
  txt := v::text;
  if v->'household'->>'household_name' <> 'García' then
    raise exception 'expected the García invite';
  end if;
  if txt like '%López%' or txt like '%N3sD8fH1jM6qP0wZ5yC2uBx%' or txt like '%admin_pin%' then
    raise exception 'invite lookup leaked another household or the pin hash';
  end if;
  if jsonb_array_length(v->'guests') <> 3 then
    raise exception 'expected 3 seats';
  end if;

  select count(*) into before_count from public.guest;

  payload := '[
    {"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","name":"Lucía García","status":"yes","meal":null,"allergies":"nueces"},
    {"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","name":"Pablo García","status":"yes","meal":null,"allergies":null},
    {"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc3","name":"Ana Ruiz","status":"no","meal":null,"allergies":null}
  ]'::jsonb;

  v := public.submit_rsvp('K7mQ2pL9xR4nW8vT3cY6hJd', payload, 'Con cariño');
  if v->>'ok' <> 'true' then
    raise exception 'first submit failed: %', v;
  end if;
  v := public.submit_rsvp('K7mQ2pL9xR4nW8vT3cY6hJd', payload, 'Con cariño');
  if v->>'ok' <> 'true' then
    raise exception 'second submit failed: %', v;
  end if;

  select count(*) into after_count from public.guest;
  if before_count <> after_count then
    raise exception 'submit duplicated guests (% -> %)', before_count, after_count;
  end if;
  if (
    select count(*) from public.guest
    where invite_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) <> 3 then
    raise exception 'García seat count changed';
  end if;
  if (
    select name from public.guest
    where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
  ) <> 'Ana Ruiz' then
    raise exception 'upsert by guest id did not keep the plus-one name';
  end if;
  if (
    select count(*) from public.message
    where invite_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) <> 1 then
    raise exception 'message was duplicated';
  end if;

  v := public.submit_rsvp(
    'K7mQ2pL9xR4nW8vT3cY6hJd',
    payload || '[{"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc4","name":"Marta López","status":"no","meal":null,"allergies":null}]'::jsonb,
    null
  );
  if v->>'error' <> 'seats' then
    raise exception 'expected seats error, got %', v;
  end if;
  if (
    select status from public.guest where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4'
  ) <> 'yes' then
    raise exception 'seat rejection modified another invite';
  end if;

  select name into other_name
  from public.guest
  where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';

  v := public.submit_rsvp(
    'K7mQ2pL9xR4nW8vT3cY6hJd',
    '[
      {"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc4","name":"Cambiada","status":"no","meal":null,"allergies":null},
      {"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","name":"Lucía García","status":"yes","meal":null,"allergies":null},
      {"id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","name":"Pablo García","status":"yes","meal":null,"allergies":null}
    ]'::jsonb,
    null
  );
  if v->>'error' <> 'invalid' then
    raise exception 'foreign guest id should be invalid, got %', v;
  end if;
  if (select name from public.guest where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4') <> other_name then
    raise exception 'foreign id rewrote another guest';
  end if;

  update public.wedding
  set rsvp_deadline = '2000-01-01T00:00:00Z'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  v := public.submit_rsvp('K7mQ2pL9xR4nW8vT3cY6hJd', payload, 'tarde');
  if v->>'error' <> 'deadline' then
    raise exception 'expected deadline error, got %', v;
  end if;
  if (select body from public.message where invite_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') = 'tarde' then
    raise exception 'deadline rejection stored a message';
  end if;

  update public.wedding
  set rsvp_deadline = '2099-01-01T00:00:00Z'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

  v := public.admin_summary('0000', 'caller-a');
  if v->>'error' <> 'wrong_passphrase' then
    raise exception 'wrong passphrase should be explicit, got %', v;
  end if;
  if jsonb_exists(v, 'households') or jsonb_exists(v, 'counts') or jsonb_exists(v, 'couple_names') then
    raise exception 'wrong passphrase returned data';
  end if;
  if (v->>'remaining')::int <> 4 then
    raise exception 'expected 4 attempts left, got %', v;
  end if;
  if v::text like '%García%' or v::text like '%$2%' or v::text like '%admin_pin_hash%' or v::text like '%hacienda-demo%' then
    raise exception 'wrong passphrase leaked data';
  end if;

  v := public.admin_summary('', 'caller-a');
  if v->>'error' <> 'wrong_passphrase' or (v->>'remaining')::int <> 3 then
    raise exception 'empty passphrase should count as a failure, got %', v;
  end if;

  v := public.admin_export('nope', 'caller-a');
  if v->>'error' <> 'wrong_passphrase' or jsonb_typeof(v) = 'array' or (v->>'remaining')::int <> 2 then
    raise exception 'wrong passphrase export returned data, got %', v;
  end if;

  delete from public.admin_attempts;

  v := public.admin_summary('hacienda-demo', 'caller-a');
  if v is null then
    raise exception 'correct pin returned nothing';
  end if;
  if v->>'couple_names' <> 'Diana y Marcelo' then
    raise exception 'expected Diana y Marcelo, got %', v->>'couple_names';
  end if;
  if v->>'wedding_date' <> '2026-12-05' then
    raise exception 'expected 5 December 2026, got %', v->>'wedding_date';
  end if;
  txt := v::text;
  if txt like '%$2%' or txt like '%admin_pin_hash%' then
    raise exception 'summary leaked the pin hash';
  end if;
  if (v->'counts'->>'yes')::int < 2 then
    raise exception 'expected yes counts, got %', v->'counts';
  end if;
  if txt not like '%wa.me/?text=%' then
    raise exception 'pending invite is missing a WhatsApp link';
  end if;
  if position('R9tG4kB7vL2xS5nJ8mQ1eAm' in txt) = 0
    or position('%2Fi%2F%3Ft%3D' in txt) = 0
  then
    raise exception 'WhatsApp text is missing the invite link';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v->'households') as household
    where household->>'household_name' = 'López'
      and household->>'whatsapp_url' is not null
  ) then
    raise exception 'an answered invite should not get a reminder';
  end if;

  v := public.admin_export('hacienda-demo', 'caller-a');
  if v is null or jsonb_typeof(v) <> 'array' then
    raise exception 'export should be a json array';
  end if;
  if v::text not like '%García%' then
    raise exception 'export missing García';
  end if;
  if v::text not like '%Acompañante de Martín%' then
    raise exception 'blank plus-one should export with the household name';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v) as elem
    where btrim(elem->>'guest_name') = ''
  ) then
    raise exception 'export has a blank guest name';
  end if;

  -- Same caller is refused even with the right passphrase.
  delete from public.admin_attempts;
  for i in 1..5 loop
    v := public.admin_summary('not-the-passphrase', 'caller-a');
    if v->>'error' <> 'wrong_passphrase' then
      raise exception 'failure % should be a wrong passphrase, got %', i, v;
    end if;
    if (v->>'remaining')::int <> 5 - i then
      raise exception 'failure % left the wrong remaining count: %', i, v;
    end if;
    if jsonb_exists(v, 'households') or v::text like '%García%' or v::text like '%Diana%' then
      raise exception 'failure % returned wedding data', i;
    end if;
  end loop;

  if (select count(*) from public.admin_attempts where ip_hash = 'caller-a') <> 5 then
    raise exception 'expected 5 recorded failures for caller-a';
  end if;

  v := public.admin_summary('hacienda-demo', 'caller-a');
  if v->>'error' <> 'locked' then
    raise exception 'same caller should be locked even with the right passphrase, got %', v;
  end if;
  if jsonb_exists(v, 'counts') or jsonb_exists(v, 'households') or jsonb_exists(v, 'couple_names') then
    raise exception 'locked summary returned data';
  end if;
  if v::text like '%García%' or v::text like '%wa.me%' or v::text like '%hacienda-demo%' or v::text like '%Diana%' then
    raise exception 'locked summary leaked data';
  end if;
  if (select count(*) from public.admin_attempts where ip_hash = 'caller-a') <> 5 then
    raise exception 'locked call should not record another failure';
  end if;

  v := public.admin_export('hacienda-demo', 'caller-a');
  if v->>'error' <> 'locked' or jsonb_typeof(v) = 'array' then
    raise exception 'locked export should return no rows, got %', v;
  end if;

  -- A different caller is not locked.
  v := public.admin_summary('hacienda-demo', 'caller-b');
  if v->>'couple_names' <> 'Diana y Marcelo' or v->>'error' = 'locked' then
    raise exception 'a different caller must not inherit the lock, got %', v;
  end if;

  v := public.admin_summary('not-the-passphrase', 'caller-c');
  if v->>'error' <> 'wrong_passphrase' or (v->>'remaining')::int <> 4 then
    raise exception 'fresh caller remaining should ignore other hashes, got %', v;
  end if;

  insert into public.admin_attempts (wedding_id, ip_hash, attempted_at)
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'flood-' || g::text, pg_catalog.now()
  from generate_series(1, 100) as g;

  v_started := clock_timestamp();
  v := public.admin_summary('hacienda-demo', 'caller-d');
  if v->>'error' = 'locked' or v->'counts' is null or v->>'couple_names' <> 'Diana y Marcelo' then
    raise exception 'hourly ceiling must not hard-lock, got %', v;
  end if;
  if clock_timestamp() - v_started < interval '2 seconds' then
    raise exception 'hourly ceiling should delay the caller';
  end if;
end
$$;

set local role anon;

do $$
declare
  v jsonb;
begin
  v := public.get_invite('N3sD8fH1jM6qP0wZ5yC2uBx');
  if v->'household'->>'household_name' <> 'López' then
    raise exception 'anon could not read its own invite via rpc';
  end if;
  if v::text like '%García%' then
    raise exception 'anon rpc leaked another invite';
  end if;

  begin
    perform 1 from public.guest;
    raise exception 'anon read the guest table';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform 1 from public.invite;
    raise exception 'anon read the invite table';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform 1 from public.wedding;
    raise exception 'anon read the wedding table';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform 1 from public.message;
    raise exception 'anon read the message table';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform 1 from public.admin_attempts;
    raise exception 'anon read admin_attempts';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.wedding_for_pin('hacienda-demo');
    raise exception 'anon called wedding_for_pin';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.admin_gate('hacienda-demo', 'caller-a');
    raise exception 'anon called admin_gate';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.admin_summary('hacienda-demo', 'caller-a');
    raise exception 'anon called admin_summary';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.admin_export('hacienda-demo', 'caller-a');
    raise exception 'anon called admin_export';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

reset role;

delete from public.admin_attempts;

set local role service_role;

do $$
declare
  v jsonb;
begin
  v := public.admin_summary('hacienda-demo', 'service-role-caller');
  if v->>'couple_names' <> 'Diana y Marcelo' then
    raise exception 'service role should read the summary, got %', v;
  end if;
  v := public.admin_export('hacienda-demo', 'service-role-caller');
  if jsonb_typeof(v) <> 'array' then
    raise exception 'service role should export rows, got %', v;
  end if;
end
$$;

reset role;

rollback;
