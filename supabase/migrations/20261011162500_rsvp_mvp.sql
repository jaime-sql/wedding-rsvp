-- Wedding RSVP schema and the only anon entry points.
-- Do not apply this file from the app. Run it yourself in the Supabase SQL editor.
--
-- Access model:
--   * RLS is enabled and there are no policies, so anon and authenticated cannot read rows.
--   * Table privileges are revoked from anon and authenticated as well.
--   * The browser uses the anon key for get_invite and submit_rsvp.
--   * admin_summary and admin_export are service_role only. The admin Edge
--     Function hashes the caller IP and calls them. anon cannot execute them.
--   * Those functions run as the owner, who bypasses RLS. That is why FORCE ROW LEVEL
--     SECURITY is intentionally not set: forcing it with zero policies would make the
--     functions return nothing. Keep the tables private and the functions narrow.
--   * search_path is empty. Every reference is schema-qualified.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create table public.wedding (
  id uuid primary key default gen_random_uuid(),
  couple_names text not null,
  wedding_date date not null,
  venue_name text not null,
  address text not null,
  map_url text not null,
  rsvp_deadline timestamptz not null,
  meal_enabled boolean not null default false,
  meal_options jsonb not null default '[]'::jsonb,
  default_lang text not null default 'es',
  admin_pin_hash text not null,
  constraint wedding_lang_check check (default_lang in ('es', 'en')),
  constraint wedding_meal_options_array check (jsonb_typeof(meal_options) = 'array'),
  constraint wedding_map_url_http check (map_url ~ '^https?://')
);

create table public.invite (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.wedding (id) on delete cascade,
  household_name text not null,
  token text not null,
  seats_allowed integer not null,
  lang text not null default 'es',
  constraint invite_token_unique unique (token),
  constraint invite_token_shape check (
    char_length(token) >= 22
    and char_length(token) <= 128
    and token ~ '^[A-Za-z0-9_-]+$'
  ),
  constraint invite_seats_check check (seats_allowed >= 1 and seats_allowed <= 20),
  constraint invite_lang_check check (lang in ('es', 'en')),
  constraint invite_household_check check (char_length(btrim(household_name)) > 0)
);

create index invite_wedding_id_idx on public.invite (wedding_id);

create table public.guest (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.invite (id) on delete cascade,
  name text not null default '',
  is_plus_one boolean not null default false,
  status text not null default 'pending',
  meal text,
  allergies text,
  position smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint guest_status_check check (status in ('pending', 'yes', 'no')),
  constraint guest_name_length check (char_length(name) <= 80),
  constraint guest_allergies_length check (allergies is null or char_length(allergies) <= 300)
);

create index guest_invite_id_idx on public.guest (invite_id);

create table public.message (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.invite (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint message_body_length check (char_length(body) <= 2000)
);

-- Failed admin passphrase tries, one row per caller hash.
-- Five failures in 15 minutes lock that (wedding, ip_hash) only.
-- One hundred failures in an hour slow every caller and never hard-lock the wedding.
create table public.admin_attempts (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.wedding (id) on delete cascade,
  ip_hash text not null,
  attempted_at timestamptz not null default pg_catalog.now(),
  constraint admin_attempts_ip_hash_check check (
    char_length(ip_hash) between 1 and 128
    and ip_hash ~ '^[A-Za-z0-9_-]+$'
  )
);

create index admin_attempts_wedding_attempted_idx
  on public.admin_attempts (wedding_id, attempted_at);

create index admin_attempts_wedding_ip_attempted_idx
  on public.admin_attempts (wedding_id, ip_hash, attempted_at);

create or replace function public.set_guest_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger guest_set_updated_at
before update on public.guest
for each row
execute function public.set_guest_updated_at();

-- URL-safe token, 24 characters, for new invites created outside the seed.
create or replace function public.generate_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'), '=');
$$;

create or replace function public.encode_uri_component(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  i integer;
  ch text;
  result text := '';
  bytes bytea;
  b integer;
begin
  if input is null or input = '' then
    return '';
  end if;
  for i in 1 .. char_length(input) loop
    ch := substr(input, i, 1);
    if octet_length(ch) = 1 and ch ~ '^[A-Za-z0-9_.~-]$' then
      result := result || ch;
    else
      bytes := convert_to(ch, 'UTF8');
      for b in 0 .. octet_length(bytes) - 1 loop
        result := result || '%' || lpad(upper(to_hex(get_byte(bytes, b))), 2, '0');
      end loop;
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.get_invite(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite public.invite%rowtype;
  v_wedding public.wedding%rowtype;
  v_guests jsonb;
  v_message text;
begin
  if token is null
    or char_length(token) < 22
    or char_length(token) > 128
    or token !~ '^[A-Za-z0-9_-]+$'
  then
    return null;
  end if;

  select * into v_invite
  from public.invite
  where invite.token = get_invite.token;

  if not found then
    return null;
  end if;

  select * into v_wedding
  from public.wedding
  where wedding.id = v_invite.wedding_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'is_plus_one', g.is_plus_one,
      'status', g.status,
      'meal', g.meal,
      'allergies', g.allergies,
      'updated_at', g.updated_at
    )
    order by g.position, g.id
  ), '[]'::jsonb)
  into v_guests
  from public.guest g
  where g.invite_id = v_invite.id;

  select m.body into v_message
  from public.message m
  where m.invite_id = v_invite.id;

  return jsonb_build_object(
    'wedding', jsonb_build_object(
      'id', v_wedding.id,
      'couple_names', v_wedding.couple_names,
      'wedding_date', v_wedding.wedding_date,
      'venue_name', v_wedding.venue_name,
      'address', v_wedding.address,
      'map_url', v_wedding.map_url,
      'rsvp_deadline', v_wedding.rsvp_deadline,
      'meal_enabled', v_wedding.meal_enabled,
      'meal_options', v_wedding.meal_options,
      'default_lang', v_wedding.default_lang
    ),
    'household', jsonb_build_object(
      'id', v_invite.id,
      'household_name', v_invite.household_name,
      'seats_allowed', v_invite.seats_allowed,
      'lang', v_invite.lang
    ),
    'guests', v_guests,
    'message', v_message
  );
end;
$$;

create or replace function public.submit_rsvp(token text, guests jsonb, message text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite public.invite%rowtype;
  v_wedding public.wedding%rowtype;
  v_len integer;
  v_index integer;
  v_elem jsonb;
  v_id uuid;
  v_id_text text;
  v_status text;
  v_name text;
  v_meal text;
  v_allergies text;
  v_plus boolean;
  v_seen uuid[] := array[]::uuid[];
  v_clean jsonb := '[]'::jsonb;
  v_row jsonb;
  v_message text;
begin
  if token is null
    or char_length(token) < 22
    or char_length(token) > 128
    or token !~ '^[A-Za-z0-9_-]+$'
  then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_invite
  from public.invite
  where invite.token = submit_rsvp.token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_wedding
  from public.wedding
  where wedding.id = v_invite.wedding_id;

  perform 1
  from public.guest
  where guest.invite_id = v_invite.id
  for update;

  if pg_catalog.now() > v_wedding.rsvp_deadline then
    return jsonb_build_object('ok', false, 'error', 'deadline');
  end if;

  if guests is null or jsonb_typeof(guests) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_len := jsonb_array_length(guests);
  if v_len > v_invite.seats_allowed then
    return jsonb_build_object('ok', false, 'error', 'seats');
  end if;

  if message is not null and char_length(message) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  for v_index in 0 .. v_len - 1 loop
    v_elem := guests -> v_index;
    if jsonb_typeof(v_elem) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    v_id_text := v_elem->>'id';
    if v_id_text is null
      or v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    v_id := v_id_text::uuid;

    if v_id = any (v_seen) then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    v_seen := array_append(v_seen, v_id);

    select g.is_plus_one into v_plus
    from public.guest g
    where g.id = v_id
      and g.invite_id = v_invite.id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    v_status := v_elem->>'status';
    if v_status is null or v_status not in ('pending', 'yes', 'no') then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    v_name := btrim(coalesce(v_elem->>'name', ''));
    if char_length(v_name) > 80 then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    if v_status = 'yes' and v_plus and char_length(v_name) = 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    v_allergies := nullif(btrim(coalesce(v_elem->>'allergies', '')), '');
    if v_allergies is not null and char_length(v_allergies) > 300 then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    if v_status <> 'yes' then
      v_allergies := null;
    end if;

    v_meal := nullif(btrim(coalesce(v_elem->>'meal', '')), '');
    if not v_wedding.meal_enabled or v_status <> 'yes' then
      v_meal := null;
    elsif v_meal is null or not exists (
      select 1
      from jsonb_array_elements(v_wedding.meal_options) as opt(value)
      where opt.value->>'id' = v_meal
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'status', v_status,
      'meal', v_meal,
      'allergies', v_allergies
    ));
  end loop;

  for v_index in 0 .. jsonb_array_length(v_clean) - 1 loop
    v_row := v_clean -> v_index;
    update public.guest g
    set
      name = v_row->>'name',
      status = v_row->>'status',
      meal = v_row->>'meal',
      allergies = v_row->>'allergies'
    where g.id = (v_row->>'id')::uuid
      and g.invite_id = v_invite.id;

    if not found then
      raise exception 'invite guest missing during update';
    end if;
  end loop;

  v_message := nullif(btrim(coalesce(message, '')), '');
  if v_message is null then
    delete from public.message m
    where m.invite_id = v_invite.id;
  else
    insert into public.message (invite_id, body)
    values (v_invite.id, v_message)
    on conflict (invite_id) do update
      set body = excluded.body,
          created_at = pg_catalog.now();
  end if;

  return jsonb_build_object('ok', true) || public.get_invite(token);
end;
$$;

-- Wedding id when the PIN matches, otherwise null. Not granted to anon.
create or replace function public.wedding_for_pin(pin text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if pin is null
    or char_length(pin) < 12
    or char_length(pin) > 72
    or char_length(btrim(pin)) < 12
  then
    return null;
  end if;

  select w.id into v_id
  from public.wedding w
  where w.admin_pin_hash = extensions.crypt(wedding_for_pin.pin, w.admin_pin_hash)
  limit 1;

  return v_id;
end;
$$;

-- Lockout shared by admin_summary and admin_export. Not granted to anon.
-- Five failures in 15 minutes lock that caller hash only.
-- One hundred failures in an hour add a delay and never hard-lock the wedding.
create or replace function public.admin_gate(pin text, caller_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_matched uuid;
  v_hash text;
  v_open integer;
  v_failures integer;
  v_hour integer;
  v_remaining integer;
begin
  v_hash := nullif(btrim(coalesce(caller_hash, '')), '');
  if v_hash is null
    or char_length(v_hash) > 128
    or v_hash !~ '^[A-Za-z0-9_-]+$'
  then
    v_hash := 'unknown';
  end if;

  v_matched := public.wedding_for_pin(pin);

  if v_matched is not null then
    select count(*) into v_failures
    from public.admin_attempts a
    where a.wedding_id = v_matched
      and a.ip_hash = v_hash
      and a.attempted_at > pg_catalog.now() - interval '15 minutes';

    select count(*) into v_hour
    from public.admin_attempts a
    where a.wedding_id = v_matched
      and a.attempted_at > pg_catalog.now() - interval '1 hour';

    if coalesce(v_hour, 0) >= 100 then
      perform pg_catalog.pg_sleep(3);
    end if;

    if v_failures >= 5 then
      return jsonb_build_object('ok', false, 'error', 'locked');
    end if;

    return jsonb_build_object('ok', true, 'wedding_id', v_matched);
  end if;

  select count(*) into v_open
  from public.wedding w
  where (
    select count(*)
    from public.admin_attempts a
    where a.wedding_id = w.id
      and a.ip_hash = v_hash
      and a.attempted_at > pg_catalog.now() - interval '15 minutes'
  ) < 5;

  if coalesce(v_open, 0) = 0 and exists (select 1 from public.wedding) then
    select coalesce(max(per_wedding.n), 0) into v_hour
    from (
      select count(*)::integer as n
      from public.admin_attempts a
      where a.attempted_at > pg_catalog.now() - interval '1 hour'
      group by a.wedding_id
    ) as per_wedding;

    if coalesce(v_hour, 0) >= 100 then
      perform pg_catalog.pg_sleep(3);
    end if;

    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  if not exists (select 1 from public.wedding) then
    perform pg_catalog.pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', 'wrong_passphrase', 'remaining', 0);
  end if;

  insert into public.admin_attempts (wedding_id, ip_hash, attempted_at)
  select w.id, v_hash, pg_catalog.now()
  from public.wedding w
  where (
    select count(*)
    from public.admin_attempts a
    where a.wedding_id = w.id
      and a.ip_hash = v_hash
      and a.attempted_at > pg_catalog.now() - interval '15 minutes'
  ) < 5;

  perform pg_catalog.pg_sleep(1);

  select coalesce(max(per_wedding.n), 0) into v_hour
  from (
    select count(*)::integer as n
    from public.admin_attempts a
    where a.attempted_at > pg_catalog.now() - interval '1 hour'
    group by a.wedding_id
  ) as per_wedding;

  if coalesce(v_hour, 0) >= 100 then
    perform pg_catalog.pg_sleep(3);
  end if;

  select min(5 - counted.n) into v_remaining
  from (
    select (
      select count(*)
      from public.admin_attempts a
      where a.wedding_id = w.id
        and a.ip_hash = v_hash
        and a.attempted_at > pg_catalog.now() - interval '15 minutes'
    ) as n
    from public.wedding w
  ) as counted;

  return jsonb_build_object(
    'ok', false,
    'error', 'wrong_passphrase',
    'remaining', greatest(coalesce(v_remaining, 0), 0)
  );
end;
$$;

create or replace function public.admin_summary(pin text, caller_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_wedding public.wedding;
  v_id uuid;
  v_gate jsonb;
  v_base constant text := 'https://jaime-sql.github.io/wedding-rsvp';
begin
  v_gate := public.admin_gate(pin, caller_hash);
  if v_gate->>'error' = 'locked' then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if coalesce(v_gate->>'ok', '') <> 'true' then
    return jsonb_build_object(
      'ok', false,
      'error', 'wrong_passphrase',
      'remaining', coalesce((v_gate->>'remaining')::integer, 0)
    );
  end if;

  v_id := (v_gate->>'wedding_id')::uuid;

  select * into v_wedding
  from public.wedding
  where wedding.id = v_id;

  return jsonb_build_object(
    'couple_names', v_wedding.couple_names,
    'wedding_date', v_wedding.wedding_date,
    'venue_name', v_wedding.venue_name,
    'rsvp_deadline', v_wedding.rsvp_deadline,
    'counts', jsonb_build_object(
      'yes', (
        select count(*)
        from public.guest g
        join public.invite i on i.id = g.invite_id
        where i.wedding_id = v_wedding.id and g.status = 'yes'
      ),
      'no', (
        select count(*)
        from public.guest g
        join public.invite i on i.id = g.invite_id
        where i.wedding_id = v_wedding.id and g.status = 'no'
      ),
      'pending', (
        select count(*)
        from public.guest g
        join public.invite i on i.id = g.invite_id
        where i.wedding_id = v_wedding.id and g.status = 'pending'
      )
    ),
    'households', (
      select coalesce(jsonb_agg(household_row.obj order by household_row.household_name), '[]'::jsonb)
      from (
        select
          i.household_name,
          jsonb_build_object(
            'household_name', i.household_name,
            'lang', i.lang,
            'pending', exists (
              select 1 from public.guest g
              where g.invite_id = i.id and g.status = 'pending'
            ),
            'whatsapp_url', case
              when exists (
                select 1 from public.guest g
                where g.invite_id = i.id and g.status = 'pending'
              )
              then 'https://wa.me/?text=' || public.encode_uri_component(
                case i.lang
                  when 'en' then format(
                    'Hello, %s family. Please confirm your attendance at the wedding of %s: %s',
                    i.household_name,
                    v_wedding.couple_names,
                    v_base || '/i/?t=' || i.token
                  )
                  else format(
                    'Hola, familia %s. Les recordamos confirmar asistencia a la boda de %s: %s',
                    i.household_name,
                    v_wedding.couple_names,
                    v_base || '/i/?t=' || i.token
                  )
                end
              )
              else null
            end,
            'guests', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'name', g.name,
                  'status', g.status,
                  'meal', g.meal,
                  'allergies', g.allergies,
                  'is_plus_one', g.is_plus_one
                )
                order by g.position, g.id
              ), '[]'::jsonb)
              from public.guest g
              where g.invite_id = i.id
            )
          ) as obj
        from public.invite i
        where i.wedding_id = v_wedding.id
      ) as household_row
    )
  );
end;
$$;

create or replace function public.admin_export(pin text, caller_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_wedding_id uuid;
  v_gate jsonb;
begin
  v_gate := public.admin_gate(pin, caller_hash);
  if v_gate->>'error' = 'locked' then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if coalesce(v_gate->>'ok', '') <> 'true' then
    return jsonb_build_object(
      'ok', false,
      'error', 'wrong_passphrase',
      'remaining', coalesce((v_gate->>'remaining')::integer, 0)
    );
  end if;

  v_wedding_id := (v_gate->>'wedding_id')::uuid;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'household_name', i.household_name,
        'guest_name', case
          when g.is_plus_one and btrim(g.name) = '' then 'Acompañante de ' || i.household_name
          else g.name
        end,
        'status', g.status,
        'meal', g.meal,
        'allergies', g.allergies,
        'is_plus_one', g.is_plus_one
      )
      order by i.household_name, g.position, g.id
    ), '[]'::jsonb)
    from public.guest g
    join public.invite i on i.id = g.invite_id
    where i.wedding_id = v_wedding_id
  );
end;
$$;

alter table public.wedding enable row level security;
alter table public.invite enable row level security;
alter table public.guest enable row level security;
alter table public.message enable row level security;
alter table public.admin_attempts enable row level security;

revoke all on table public.wedding from public, anon, authenticated;
revoke all on table public.invite from public, anon, authenticated;
revoke all on table public.guest from public, anon, authenticated;
revoke all on table public.message from public, anon, authenticated;
revoke all on table public.admin_attempts from public, anon, authenticated;

revoke all on function public.set_guest_updated_at() from public, anon, authenticated;
revoke all on function public.generate_invite_token() from public, anon, authenticated;
revoke all on function public.encode_uri_component(text) from public, anon, authenticated;
revoke all on function public.wedding_for_pin(text) from public, anon, authenticated;
revoke all on function public.admin_gate(text, text) from public, anon, authenticated;

revoke all on function public.get_invite(text) from public, anon, authenticated;
revoke all on function public.submit_rsvp(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_summary(text, text) from public, anon, authenticated;
revoke all on function public.admin_export(text, text) from public, anon, authenticated;

grant execute on function public.get_invite(text) to anon;
grant execute on function public.submit_rsvp(text, jsonb, text) to anon;
grant execute on function public.admin_summary(text, text) to service_role;
grant execute on function public.admin_export(text, text) to service_role;
