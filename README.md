# Wedding RSVP

Bilingual wedding site with a private-link RSVP. Spanish is the default, with an English switch. The static site is built with Astro and Tailwind and deployed to GitHub Pages at [https://jaime-sql.github.io/wedding-rsvp/](https://jaime-sql.github.io/wedding-rsvp/). Supabase is the backend. The browser calls it with the anon key, and only through a few database functions.

Without `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`, the site runs in local demo mode on sample data stored in the browser. An amber strip on every page, including admin, reads Datos de ejemplo.

## Local demo

```bash
npm ci
npm test
npm run dev
```

Open [http://localhost:4321/wedding-rsvp/](http://localhost:4321/wedding-rsvp/).

Sample invitations:

- García: `/wedding-rsvp/i/?t=K7mQ2pL9xR4nW8vT3cY6hJd`
- López: `/wedding-rsvp/i/?t=N3sD8fH1jM6qP0wZ5yC2uBx`
- Martín: `/wedding-rsvp/i/?t=R9tG4kB7vL2xS5nJ8mQ1eAm`
- Admin: `/wedding-rsvp/admin/`

The demo admin passphrase is `hacienda-demo` (at least 12 characters). It is shown on the admin page only while demo mode is on. A build with Supabase keys never shows it. Meal choice is off. Turn it on by setting `meal_enabled` on the wedding row.

The date, venue, and RSVP deadline in the sample are marked DEMO. Replace them before a real wedding.

## Supabase

This repository does not apply the database for you.

1. Create a Supabase project.
2. In the SQL editor, run `supabase/migrations/20261011162500_rsvp_mvp.sql`.
3. Run `supabase/seed.sql` if you want the sample wedding.
4. Change the passphrase before real guests use it. Use at least 12 characters:

```sql
update public.wedding
set admin_pin_hash = extensions.crypt('a-new-passphrase', extensions.gen_salt('bf', 8))
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
```

Tables have row level security enabled and no policies. `anon` cannot read or write them. The anon key can call only:

- `get_invite(token)` returns that household, or nothing.
- `submit_rsvp(token, guests, message)` updates those guest ids until the deadline, in one transaction. It rejects an oversized guest list and a guest id from another invite.
- `admin_summary(pin)` and `admin_export(pin)` check a bcrypt passphrase of 12 to 72 characters. A wrong passphrase returns `wrong_passphrase` and how many attempts remain, with no guest data. Five failures in 15 minutes lock that wedding for the rest of the window: the sixth call is refused with `locked` even when the passphrase is right. Each failure waits one second. Pending invites include a `wa.me` link with the invitation URL in Spanish or English. A plus-one with no name exports as `Acompañante de <household>`.

Copy the project URL and the anon key. Do not put the service role key in the site.

Create `.env` from `.env.example`:

```bash
PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

`npm run dev` and `npm run build` read those values. If either is missing, the build stays in demo mode.

## GitHub Pages

In the repository settings, set Pages to deploy from GitHub Actions. Add two Actions secrets:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

`.github/workflows/pages.yml` runs the tests and builds on every push to `main`, then deploys `dist`. The site config is `site: https://jaime-sql.github.io` and `base: /wedding-rsvp`.

Leave the secrets empty if you want the public site to stay on sample data.

## Checks

`npm run typecheck`, `npm run lint`, and `npm test` cover the client helpers for tokens, seat limits, the deadline, idempotent updates by guest id, the admin passphrase, both languages, and the CSV BOM. `.github/workflows/ci.yml` runs those checks and the build on pull requests and pushes.

`supabase/tests/rsvp.sql` is a plain SQL script in the same spirit. It is not applied automatically. Against a throwaway database:

```bash
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261011162500_rsvp_mvp.sql
psql -v ON_ERROR_STOP=1 -f supabase/seed.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rsvp.sql
```

The script rolls back its writes.
