-- Repair a database created from the first published RSVP migration, where
-- admin failures were counted per wedding and anon could call admin_summary
-- and admin_export. Also safe after the current first migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

alter table public.admin_attempts add column if not exists ip_hash text;

update public.admin_attempts
set ip_hash = 'legacy'
where ip_hash is null;

alter table public.admin_attempts alter column ip_hash set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_attempts_ip_hash_check'
  ) then
    alter table public.admin_attempts
      add constraint admin_attempts_ip_hash_check
      check (
        char_length(ip_hash) between 1 and 128
        and ip_hash ~ '^[A-Za-z0-9_-]+$'
      );
  end if;
end
$$;

create index if not exists admin_attempts_wedding_ip_attempted_idx
  on public.admin_attempts (wedding_id, ip_hash, attempted_at);

drop function if exists public.admin_summary(text);
drop function if exists public.admin_export(text);
drop function if exists public.admin_gate(text);

-- Lockout shared by admin_summary and admin_export. Not granted to anon.
-- Five failures in 15 minutes lock that caller hash only.
-- Thirty failures in an hour add an increasing delay up to 10 seconds and never hard-lock the wedding.
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
  v_until timestamptz;
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

    if coalesce(v_hour, 0) >= 30 then
      -- Two seconds at the 30th failure, then one more second each, at most 10. Never a hard lock.
      perform pg_catalog.pg_sleep(least(10, greatest(2, v_hour - 28)));
    end if;

    if v_failures >= 5 then
      select min(a.attempted_at) + interval '15 minutes' into v_until
      from public.admin_attempts a
      where a.wedding_id = v_matched
        and a.ip_hash = v_hash
        and a.attempted_at > pg_catalog.now() - interval '15 minutes';

      return jsonb_build_object(
        'ok', false,
        'error', 'locked',
        'locked_until', v_until
      );
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

    if coalesce(v_hour, 0) >= 30 then
      perform pg_catalog.pg_sleep(least(10, greatest(2, v_hour - 28)));
    end if;

    select min(a.attempted_at) + interval '15 minutes' into v_until
    from public.admin_attempts a
    where a.ip_hash = v_hash
      and a.attempted_at > pg_catalog.now() - interval '15 minutes';

    return jsonb_build_object(
      'ok', false,
      'error', 'locked',
      'locked_until', v_until
    );
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

  select coalesce(max(per_wedding.n), 0) into v_hour
  from (
    select count(*)::integer as n
    from public.admin_attempts a
    where a.attempted_at > pg_catalog.now() - interval '1 hour'
    group by a.wedding_id
  ) as per_wedding;

  if coalesce(v_hour, 0) >= 30 then
    perform pg_catalog.pg_sleep(least(10, greatest(2, v_hour - 28)));
  else
    perform pg_catalog.pg_sleep(1);
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
    return jsonb_build_object(
      'ok', false,
      'error', 'locked',
      'locked_until', v_gate->'locked_until'
    );
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
    return jsonb_build_object(
      'ok', false,
      'error', 'locked',
      'locked_until', v_gate->'locked_until'
    );
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

-- Operator helper for the SQL editor. A real passphrase is 20 to 72 characters.
create or replace function public.set_admin_passphrase(wedding_id uuid, passphrase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if set_admin_passphrase.passphrase is null
    or char_length(set_admin_passphrase.passphrase) < 20
    or char_length(set_admin_passphrase.passphrase) > 72
    or char_length(btrim(set_admin_passphrase.passphrase)) < 20
  then
    raise exception 'admin passphrase must be 20 to 72 characters';
  end if;

  update public.wedding
  set admin_pin_hash = extensions.crypt(
    set_admin_passphrase.passphrase,
    extensions.gen_salt('bf')
  )
  where public.wedding.id = set_admin_passphrase.wedding_id;

  if not found then
    raise exception 'wedding not found';
  end if;
end;
$$;

revoke all on function public.set_admin_passphrase(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_gate(text, text) from public, anon, authenticated;
revoke all on function public.admin_summary(text, text) from public, anon, authenticated;
revoke all on function public.admin_export(text, text) from public, anon, authenticated;

grant execute on function public.admin_summary(text, text) to service_role;
grant execute on function public.admin_export(text, text) to service_role;
