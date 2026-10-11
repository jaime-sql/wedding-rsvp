import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guestsToCsv } from '../src/lib/csv';
import { DEMO_PIN, TOKENS, createInitialState } from '../src/lib/demo-data';
import { buildIcs } from '../src/lib/ics';
import { en, es, type MessageKey } from '../src/lib/i18n';
import {
  adminExport,
  adminLockout,
  adminSummary,
  applySubmit,
  formatDeadline,
  formatPlaces,
  formatWeddingDate,
  replySummary,
  seatsForFamily,
  exportGuestName,
  getInvite,
  hasUnanswered,
  passphraseMatches,
  reminderText,
  isPastDeadline,
  missingPlusOneName,
  showPlusOneName,
  tokenProblem,
} from '../src/lib/rsvp';
import type { GuestInput } from '../src/lib/types';

const origin = 'https://jaime-sql.github.io';
const base = '/wedding-rsvp';
const now = new Date('2026-10-11T12:00:00Z');

function garciaPayload(nameForPlusOne = '', plusStatus: 'yes' | 'no' | 'pending' = 'no'): GuestInput[] {
  const invite = createInitialState().invites[0];
  return invite.guests.map((guest, index) => ({
    id: guest.id,
    name: guest.is_plus_one ? nameForPlusOne : guest.name,
    status: guest.is_plus_one ? plusStatus : 'yes',
    meal: null,
    allergies: index === 0 ? 'nueces' : null,
  }));
}

describe('token lookup', () => {
  const state = createInitialState();

  it('treats a missing token as missing and a short one as invalid', () => {
    expect(tokenProblem(null)).toBe('missing');
    expect(tokenProblem('')).toBe('missing');
    expect(tokenProblem('   ')).toBe('missing');
    expect(tokenProblem('short-token')).toBe('invalid');
    expect(tokenProblem(TOKENS.garcia)).toBeNull();
    expect(getInvite(state, null)).toBeNull();
    expect(getInvite(state, 'short-token')).toBeNull();
    expect(getInvite(state, 'this-token-is-long-enough-x')).toBeNull();
  });

  it('returns only the household for that token', () => {
    const view = getInvite(state, TOKENS.garcia);
    expect(view?.household.household_name).toBe('García');
    expect(view?.guests).toHaveLength(3);
    const json = JSON.stringify(view);
    expect(json).not.toContain('López');
    expect(json).not.toContain('Martín');
    expect(json).not.toContain(TOKENS.lopez);
    expect(json).not.toContain(TOKENS.martin);
    expect(json).not.toContain(DEMO_PIN);
    expect(json).not.toContain('admin_pin');
  });
});

describe('seats, deadline, and idempotent submits', () => {
  it('formats the seat counter', () => {
    expect(formatPlaces(2, 3, 'es')).toBe('2 de 3 lugares');
    expect(formatPlaces(2, 3, 'en')).toBe('2 of 3 seats');
    expect(formatPlaces(1, 1, 'es')).toBe('1 de 1 lugar');
  });

  it('formats the household seat line in singular and plural', () => {
    expect(seatsForFamily(3, 'es')).toBe('3 lugares para su familia');
    expect(seatsForFamily(3, 'en')).toBe('3 seats for your family');
    expect(seatsForFamily(1, 'es')).toBe('1 lugar para su familia');
    expect(seatsForFamily(1, 'en')).toBe('1 seat for your family');
  });

  it('summarizes yes and no guests, including a nameless plus-one', () => {
    const guests = [
      { name: 'Lucía García', is_plus_one: false, status: 'yes' as const },
      { name: 'Pablo García', is_plus_one: false, status: 'yes' as const },
      { name: '  ', is_plus_one: true, status: 'no' as const },
    ];
    expect(replySummary(guests, 'es')).toBe('Lucía García, Pablo García: Sí · Acompañante: No');
    expect(replySummary(guests, 'en')).toBe('Lucía García, Pablo García: Yes · Plus-one: No');
    expect(
      replySummary(
        [
          { name: 'Sofía Martín', is_plus_one: false, status: 'no' },
          { name: '', is_plus_one: true, status: 'pending' },
        ],
        'en',
      ),
    ).toBe('Sofía Martín: No · Plus-one: Pending');
  });

  it('shows a plus-one name only after yes', () => {
    expect(showPlusOneName({ is_plus_one: true, status: 'pending' })).toBe(false);
    expect(showPlusOneName({ is_plus_one: true, status: 'no' })).toBe(false);
    expect(showPlusOneName({ is_plus_one: true, status: 'yes' })).toBe(true);
    expect(showPlusOneName({ is_plus_one: false, status: 'yes' })).toBe(false);
  });

  it('rejects more guests than seats and does not change anyone else', () => {
    const state = createInitialState();
    const payload = [
      ...garciaPayload('Ana Ruiz', 'no'),
      {
        id: state.invites[1].guests[0].id,
        name: 'Marta López',
        status: 'no' as const,
        meal: null,
        allergies: null,
      },
    ];
    const outcome = applySubmit(state, TOKENS.garcia, payload, null, now);
    expect(outcome.result).toEqual({ ok: false, error: 'seats' });
    expect(outcome.state).toBe(state);
    expect(state.invites[1].guests[0].status).toBe('yes');
    expect(state.invites[1].guests[0].name).toBe('Marta López');
  });

  it('rejects a guest id from another invite', () => {
    const state = createInitialState();
    const foreign = state.invites[1].guests[0];
    const payload = garciaPayload().map((guest, index) =>
      index === 0
        ? { ...guest, id: foreign.id, name: 'Cambiada', status: 'no' as const }
        : guest,
    );
    const outcome = applySubmit(state, TOKENS.garcia, payload, null, now);
    expect(outcome.result).toEqual({ ok: false, error: 'invalid' });
    expect(outcome.state).toBe(state);
    expect(foreign.name).toBe('Marta López');
    expect(foreign.status).toBe('yes');
  });

  it('rejects a blank plus-one who said yes', () => {
    const state = createInitialState();
    const outcome = applySubmit(state, TOKENS.garcia, garciaPayload('', 'yes'), null, now);
    expect(outcome.result).toEqual({ ok: false, error: 'invalid' });
    expect(missingPlusOneName([{ is_plus_one: true, status: 'yes', name: '  ' }])).toBe(true);
  });

  it('blocks unanswered seats in the client check', () => {
    expect(hasUnanswered(createInitialState().invites[0].guests)).toBe(true);
  });

  it('rejects submissions after the deadline without writing', () => {
    const state = createInitialState();
    expect(isPastDeadline(state.wedding.rsvp_deadline, new Date('2027-05-01T21:59:00.000Z'))).toBe(false);
    expect(isPastDeadline(state.wedding.rsvp_deadline, new Date('2027-05-01T21:59:00.001Z'))).toBe(true);
    const outcome = applySubmit(state, TOKENS.garcia, garciaPayload('Ana Ruiz', 'no'), 'tarde', new Date('2028-01-01T00:00:00Z'));
    expect(outcome.result).toEqual({ ok: false, error: 'deadline' });
    expect(outcome.state).toBe(state);
    expect(state.invites[0].message).toBeNull();
  });

  it('updates by guest id and does not duplicate guests on a second submit', () => {
    const state = createInitialState();
    const payload = garciaPayload('Ana Ruiz', 'no');
    const first = applySubmit(state, TOKENS.garcia, payload, 'Hola', now);
    const second = applySubmit(first.state, TOKENS.garcia, payload, 'Hola de nuevo', now);
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    const saved = second.state.invites[0];
    expect(saved.guests.map((guest) => guest.id)).toEqual(state.invites[0].guests.map((guest) => guest.id));
    expect(saved.guests).toHaveLength(3);
    expect(second.state.invites.reduce((total, invite) => total + invite.guests.length, 0)).toBe(7);
    expect(saved.guests[2].name).toBe('Ana Ruiz');
    expect(saved.guests[2].status).toBe('no');
    expect(saved.guests[0].allergies).toBe('nueces');
    expect(saved.message).toBe('Hola de nuevo');
    expect(saved.guests[0].meal).toBeNull();
  });

  it('drops a meal when the setting is off and requires one when it is on', () => {
    const off = applySubmit(createInitialState(), TOKENS.garcia, [
      { ...garciaPayload()[0], meal: 'carne' },
    ], null, now);
    expect(off.result.ok).toBe(true);
    if (off.result.ok) {
      expect(off.result.payload.guests[0].meal).toBeNull();
    }

    const enabled = createInitialState();
    enabled.wedding = { ...enabled.wedding, meal_enabled: true };
    const missing = applySubmit(enabled, TOKENS.garcia, [{ ...garciaPayload()[0], meal: null }], null, now);
    expect(missing.result).toEqual({ ok: false, error: 'invalid' });
    const chosen = applySubmit(enabled, TOKENS.garcia, [{ ...garciaPayload()[0], meal: 'carne' }], null, now);
    expect(chosen.result.ok).toBe(true);
    if (chosen.result.ok) expect(chosen.result.payload.guests[0].meal).toBe('carne');
  });
});

describe('admin pin', () => {
  const state = createInitialState();

  it('returns nothing for a wrong pin', () => {
    expect(passphraseMatches('0000', DEMO_PIN)).toBe(false);
    expect(passphraseMatches('hacienda-demo ', DEMO_PIN)).toBe(false);
    expect(passphraseMatches(DEMO_PIN, DEMO_PIN)).toBe(true);
    expect(DEMO_PIN.length).toBeGreaterThanOrEqual(12);
    expect(adminSummary(state, '0000', origin, base, DEMO_PIN)).toBeNull();
    expect(adminSummary(state, '', origin, base, DEMO_PIN)).toBeNull();
    expect(adminSummary(state, 'hacienda-demo ', origin, base, DEMO_PIN)).toBeNull();
    expect(adminExport(state, 'nope', DEMO_PIN)).toBeNull();
  });

  it('locks the sixth call even when the passphrase is right', () => {
    expect(adminLockout(0, false)).toEqual({ ok: false, error: 'wrong_passphrase', remaining: 4 });
    expect(adminLockout(4, false)).toEqual({ ok: false, error: 'wrong_passphrase', remaining: 0 });
    expect(adminLockout(5, true)).toEqual({ ok: false, error: 'locked' });
    expect(adminLockout(5, false)).toEqual({ ok: false, error: 'locked' });
    expect(adminLockout(4, true)).toEqual({ ok: true });
  });

  it('returns counts and WhatsApp reminders for the matching pin', () => {
    const summary = adminSummary(state, DEMO_PIN, origin, base, DEMO_PIN);
    expect(summary?.counts).toEqual({ yes: 2, no: 1, pending: 4 });
    expect(JSON.stringify(summary)).not.toContain(DEMO_PIN);
    const garcia = summary?.households.find((household) => household.household_name === 'García');
    const lopez = summary?.households.find((household) => household.household_name === 'López');
    const martin = summary?.households.find((household) => household.household_name === 'Martín');
    expect(lopez?.whatsapp_url).toBeNull();
    expect(garcia?.whatsapp_url).toContain('https://wa.me/?text=');
    const text = new URL(garcia?.whatsapp_url ?? '').searchParams.get('text');
    expect(text).toContain(`${origin}${base}/i/?t=${TOKENS.garcia}`);
    expect(text).toContain('Hola, familia García');
    expect(text).toContain('Les recordamos');
    expect(text).not.toContain('Os recordamos');
    expect(reminderText('es', 'García', 'Elena y Mateo', `${origin}${base}/i/?t=${TOKENS.garcia}`)).toContain(
      'Les recordamos',
    );
    const english = new URL(martin?.whatsapp_url ?? '').searchParams.get('text');
    expect(english).toContain('Hello, Martín family');
    expect(english).toContain(TOKENS.martin);
    const rows = adminExport(state, DEMO_PIN, DEMO_PIN);
    expect(rows?.some((row) => row.guest_name === 'Lucía García')).toBe(true);
    expect(rows?.some((row) => row.guest_name === 'Acompañante de García')).toBe(true);
    expect(rows?.some((row) => row.guest_name === 'Acompañante de Martín')).toBe(true);
    expect(rows?.some((row) => row.guest_name.trim() === '')).toBe(false);
    expect(exportGuestName('', true, 'Martín')).toBe('Acompañante de Martín');
    expect(exportGuestName('Ana Ruiz', true, 'García')).toBe('Ana Ruiz');
  });
});

describe('copy, csv, and calendar', () => {
  it('keeps every string in both languages', () => {
    const keys = Object.keys(es) as MessageKey[];
    expect(Object.keys(en).sort()).toEqual(keys.sort());
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of keys) {
      expect(es[key].trim().length).toBeGreaterThan(0);
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(placeholders(en[key])).toEqual(placeholders(es[key]));
    }
    expect(es.demoStrip).toBe('Datos de ejemplo');
    expect(en.demoStrip).toBe('Sample data');
    expect(es.wrongPassphrase).toBe('Clave incorrecta. Le quedan {remaining} intentos.');
    expect(es.wrongPassphraseOne).toBe('Clave incorrecta. Le queda {remaining} intento.');
    expect(es.adminLocked).toBe('Demasiados intentos. Intente de nuevo en 15 minutos.');
    expect(en.wrongPassphrase).toBe('Wrong passphrase. You have {remaining} attempts left.');
    expect(en.adminLocked).toBe('Too many attempts. Try again in 15 minutes.');
    const spanish = Object.values(es).join('\n');
    for (const old of ['Abrid', 'Elegid', 'Os recordamos', 'vuestra', 'Podéis', 'Volved', 'Entrad', 'Revisad', 'Intentad', 'Escribid']) {
      expect(spanish).not.toContain(old);
    }
    const errors = `${es.invalidBody} ${en.invalidBody} ${es.missingBody} ${en.adminEmpty}`;
    expect(errors).not.toContain('García');
    expect(errors).not.toContain('López');
    expect(errors).not.toContain(TOKENS.garcia);
  });

  it('writes a UTF-8 CSV with a BOM so García survives Excel', () => {
    const csv = guestsToCsv(
      [
        {
          household_name: 'García',
          guest_name: 'Lucía García',
          status: 'yes',
          meal: null,
          allergies: 'nueces',
          is_plus_one: false,
        },
      ],
      'es',
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Lucía García');
    expect(csv).toContain('García');
    expect(csv).toContain('\r\n');
  });

  it('builds an all-day calendar event for the sample date', () => {
    const ics = buildIcs(createInitialState().wedding, now);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270620');
    expect(ics).toContain('SUMMARY:Elena y Mateo');
    expect(formatWeddingDate('2027-06-20', 'es')).toBe('20 de junio de 2027');
    expect(formatWeddingDate('2027-06-20', 'en')).toBe('20 June 2027');
    expect(formatDeadline('2027-05-01T21:59:00.000Z', 'es')).toContain('2027');
    expect(formatDeadline('2027-05-01T21:59:00.000Z', 'es')).toContain('23:59');
  });
});

describe('repo contract', () => {
  const migration = readFileSync('supabase/migrations/20261011162500_rsvp_mvp.sql', 'utf8');
  const seed = readFileSync('supabase/seed.sql', 'utf8');
  const astro = readFileSync('astro.config.mjs', 'utf8');
  const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');

  it('publishes the project site with the repository base', () => {
    expect(astro).toContain("site: 'https://jaime-sql.github.io'");
    expect(astro).toContain("base: '/wedding-rsvp'");
  });

  it('builds Pages from the two public secrets', () => {
    expect(workflow).toContain('secrets.PUBLIC_SUPABASE_URL');
    expect(workflow).toContain('secrets.PUBLIC_SUPABASE_ANON_KEY');
    expect(workflow).toContain('branches: [main]');
  });

  it('locks tables and exposes only the anon RPCs', () => {
    expect(migration.toLowerCase()).not.toContain('create policy');
    for (const table of ['wedding', 'invite', 'guest', 'message', 'admin_attempts']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
    for (const fn of ['get_invite', 'submit_rsvp', 'admin_summary', 'admin_export']) {
      expect(migration).toContain(`function public.${fn}`);
      expect(migration).toContain(`grant execute on function public.${fn}`);
    }
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = \'\'');
    expect(migration).toContain('extensions.crypt');
    expect(migration).toContain('v_len > v_invite.seats_allowed');
    expect(migration).toContain("error', 'deadline'");
    expect(migration).toContain("error', 'seats'");
    expect(migration).not.toContain('execute format');
    expect(migration).toContain('admin_attempts');
    expect(migration).toContain('pg_catalog.pg_sleep(1)');
    expect(migration).toContain("'wrong_passphrase'");
    expect(migration).toContain("'locked'");
    expect(migration).toContain('Les recordamos');
    expect(migration).toContain('Acompañante de ');
    expect(migration).not.toContain('grant execute on function public.admin_gate');
    const sqlTest = readFileSync('supabase/tests/rsvp.sql', 'utf8');
    expect(sqlTest).toContain('6th call is refused even with the right passphrase');
    expect(sqlTest).toContain("public.admin_summary('hacienda-demo')");
  });

  it('seeds the demo wedding, three invites, and a hashed PIN', () => {
    expect(seed).toContain(TOKENS.garcia);
    expect(seed).toContain(TOKENS.lopez);
    expect(seed).toContain(TOKENS.martin);
    expect(seed).toContain('Hacienda Los Olivos (DEMO)');
    expect(seed).toContain('2027-06-20');
    expect(seed).toContain('2027-05-01T21:59:00Z');
    expect(seed).toContain("extensions.crypt('hacienda-demo'");
    expect(seed).toContain('false');
    expect(seed).toContain('Lucía García');
  });
});
