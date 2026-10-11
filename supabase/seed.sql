-- Sample wedding. DEMO values only. Apply after the migration, and change the
-- passphrase before anyone real uses the site. Use set_admin_passphrase, which
-- requires 20 to 72 characters. See the README for a 5-word diceware phrase.
--
-- Demo passphrase: hacienda-demo
-- Invite links (production base):
--   García  https://jaime-sql.github.io/wedding-rsvp/i/?t=K7mQ2pL9xR4nW8vT3cY6hJd
--   López   https://jaime-sql.github.io/wedding-rsvp/i/?t=N3sD8fH1jM6qP0wZ5yC2uBx
--   Martín  https://jaime-sql.github.io/wedding-rsvp/i/?t=R9tG4kB7vL2xS5nJ8mQ1eAm

begin;

delete from public.wedding
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

insert into public.wedding (
  id,
  couple_names,
  wedding_date,
  venue_name,
  address,
  map_url,
  rsvp_deadline,
  meal_enabled,
  meal_options,
  default_lang,
  admin_pin_hash
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'Diana y Marcelo',
  '2026-12-05',
  'Hacienda Los Olivos (DEMO)',
  'Ctra. de Carmona km 4, Sevilla (DEMO)',
  'https://maps.google.com/?q=Hacienda+Los+Olivos+Sevilla',
  '2026-11-15T05:59:00Z',
  false,
  '[
    {"id":"carne","es":"Carne","en":"Meat"},
    {"id":"pescado","es":"Pescado","en":"Fish"},
    {"id":"vegetariano","es":"Vegetariano","en":"Vegetarian"}
  ]'::jsonb,
  'es',
  extensions.crypt('hacienda-demo', extensions.gen_salt('bf', 8))
);

insert into public.invite (id, wedding_id, household_name, token, seats_allowed, lang) values
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'García',
    'K7mQ2pL9xR4nW8vT3cY6hJd',
    3,
    'es'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'López',
    'N3sD8fH1jM6qP0wZ5yC2uBx',
    2,
    'es'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'Martín',
    'R9tG4kB7vL2xS5nJ8mQ1eAm',
    2,
    'en'
  );

insert into public.guest (
  id, invite_id, name, is_plus_one, status, meal, allergies, position, updated_at
) values
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'Lucía García',
    false,
    'pending',
    null,
    null,
    1,
    '2026-01-01T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'Pablo García',
    false,
    'pending',
    null,
    null,
    2,
    '2026-01-01T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '',
    true,
    'pending',
    null,
    null,
    3,
    '2026-01-01T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'Marta López',
    false,
    'yes',
    null,
    'frutos secos',
    1,
    '2026-02-01T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'Andrés López',
    false,
    'yes',
    null,
    null,
    2,
    '2026-02-01T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc6',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'Sofía Martín',
    false,
    'no',
    null,
    null,
    1,
    '2026-03-01T00:00:00Z'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc7',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    '',
    true,
    'pending',
    null,
    null,
    2,
    '2026-03-01T00:00:00Z'
  );

insert into public.message (invite_id, body) values
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '¡Allí estaremos!'
  );

commit;
