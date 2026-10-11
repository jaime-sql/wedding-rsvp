import { t, type Lang } from './i18n';
import type { DemoInvite, DemoState } from './demo-data';
import type {
  AdminSummary,
  ExportRow,
  GuestInput,
  GuestRecord,
  InvitePayload,
  RsvpStatus,
  SubmitResult,
  SummaryHousehold,
} from './types';

type State = DemoState;

const STATUSES: readonly RsvpStatus[] = ['pending', 'yes', 'no'];

export function isAcceptableToken(token: string | null | undefined): token is string {
  if (typeof token !== 'string') return false;
  if (token.length < 22 || token.length > 128) return false;
  return /^[A-Za-z0-9_-]+$/.test(token);
}

export function tokenProblem(token: string | null): 'missing' | 'invalid' | null {
  if (token === null || token.trim() === '') return 'missing';
  if (!isAcceptableToken(token)) return 'invalid';
  return null;
}

export function isPastDeadline(deadlineIso: string, now: Date): boolean {
  const deadline = Date.parse(deadlineIso);
  if (Number.isNaN(deadline)) return true;
  return now.getTime() > deadline;
}

export function attendingCount(guests: Array<{ status: string }>): number {
  return guests.filter((guest) => guest.status === 'yes').length;
}

export function formatPlaces(count: number, total: number, lang: Lang): string {
  const key = total === 1 ? 'placeOne' : 'places';
  return t(lang, key, { count, total });
}

export function seatsForFamily(count: number, lang: Lang): string {
  const key = count === 1 ? 'seatForFamily' : 'seatsForFamily';
  return t(lang, key, { count });
}

export function replySummary(
  guests: Array<{ name: string; is_plus_one: boolean; status: RsvpStatus }>,
  lang: Lang,
): string {
  const order: RsvpStatus[] = ['yes', 'no', 'pending'];
  const parts: string[] = [];
  for (const status of order) {
    const names = guests
      .filter((guest) => guest.status === status)
      .map((guest) => {
        const trimmed = guest.name.trim();
        if (trimmed) return trimmed;
        return guest.is_plus_one ? t(lang, 'plusOneLabel') : t(lang, 'dash');
      });
    if (names.length === 0) continue;
    parts.push(`${names.join(', ')}: ${t(lang, status)}`);
  }
  return parts.join(' · ');
}

export function showPlusOneName(guest: { is_plus_one: boolean; status: string }): boolean {
  return guest.is_plus_one && guest.status === 'yes';
}

export function hasUnanswered(guests: Array<{ status: string }>): boolean {
  return guests.some((guest) => guest.status === 'pending');
}

export function missingPlusOneName(
  guests: Array<{ is_plus_one: boolean; status: string; name: string }>,
): boolean {
  return guests.some(
    (guest) => guest.is_plus_one && guest.status === 'yes' && guest.name.trim() === '',
  );
}

export function missingMeal(
  mealEnabled: boolean,
  guests: Array<{ status: string; meal: string | null }>,
): boolean {
  if (!mealEnabled) return false;
  return guests.some((guest) => guest.status === 'yes' && !guest.meal);
}

export function sampleMarks(venueName: string): boolean {
  return venueName.includes('(DEMO)');
}

export function formatWeddingDate(isoDate: string, lang: Lang): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (lang === 'en') {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  const formatted = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return formatted.replace(/,\s*/, ' ');
}

export function formatDeadline(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/El_Salvador',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function inviteLink(origin: string, basePath: string, token: string): string {
  const trimmed = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const prefix = trimmed === '' || trimmed === '/' ? '' : trimmed;
  return `${origin}${prefix}/i/?t=${encodeURIComponent(token)}`;
}

export function reminderText(
  lang: Lang,
  household: string,
  couple: string,
  link: string,
): string {
  if (lang === 'en') {
    return `Hello, ${household} family. Please confirm your attendance at the wedding of ${couple}: ${link}`;
  }
  return `Hola, familia ${household}. Les recordamos confirmar asistencia a la boda de ${couple}: ${link}`;
}

export function whatsappReminder(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    return null;
  }
  return null;
}

export function mealLabel(
  options: Array<{ id: string; es: string; en: string }>,
  id: string | null,
  lang: Lang,
): string | null {
  if (!id) return null;
  const match = options.find((option) => option.id === id);
  if (!match) return null;
  return lang === 'en' ? match.en : match.es;
}

function toPayload(state: State, invite: DemoInvite): InvitePayload {
  return {
    wedding: {
      ...state.wedding,
      meal_options: state.wedding.meal_options.map((option) => ({ ...option })),
    },
    household: {
      id: invite.id,
      household_name: invite.household_name,
      seats_allowed: invite.seats_allowed,
      lang: invite.lang,
    },
    guests: invite.guests.map((guest) => ({ ...guest })),
    message: invite.message,
  };
}

export function getInvite(state: State, token: string | null | undefined): InvitePayload | null {
  if (!isAcceptableToken(token)) return null;
  const matches = state.invites.filter((invite) => invite.token === token);
  if (matches.length !== 1) return null;
  return toPayload(state, matches[0]);
}

function isStatus(value: unknown): value is RsvpStatus {
  return typeof value === 'string' && STATUSES.includes(value as RsvpStatus);
}

export function applySubmit(
  state: State,
  token: string | null | undefined,
  guests: unknown,
  message: unknown,
  now: Date,
): { state: State; result: SubmitResult } {
  if (!isAcceptableToken(token)) {
    return { state, result: { ok: false, error: 'not_found' } };
  }
  const invite = state.invites.find((item) => item.token === token);
  if (!invite) {
    return { state, result: { ok: false, error: 'not_found' } };
  }
  if (isPastDeadline(state.wedding.rsvp_deadline, now)) {
    return { state, result: { ok: false, error: 'deadline' } };
  }
  if (!Array.isArray(guests)) {
    return { state, result: { ok: false, error: 'invalid' } };
  }
  if (guests.length > invite.seats_allowed) {
    return { state, result: { ok: false, error: 'seats' } };
  }
  if (message !== null && message !== undefined && typeof message !== 'string') {
    return { state, result: { ok: false, error: 'invalid' } };
  }
  if (typeof message === 'string' && message.length > 2000) {
    return { state, result: { ok: false, error: 'invalid' } };
  }

  const seen = new Set<string>();
  const clean: GuestInput[] = [];
  for (const item of guests) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || seen.has(record.id)) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    seen.add(record.id);
    const existing = invite.guests.find((guest) => guest.id === record.id);
    if (!existing) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    if (!isStatus(record.status)) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    if (typeof record.name !== 'string' || record.name.trim().length > 80) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    const name = record.name.trim();
    if (record.status === 'yes' && existing.is_plus_one && name.length === 0) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    const allergiesRaw = record.allergies;
    if (allergiesRaw !== null && allergiesRaw !== undefined && typeof allergiesRaw !== 'string') {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    let allergies = typeof allergiesRaw === 'string' ? allergiesRaw.trim() : '';
    if (allergies.length > 300) {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    if (record.status !== 'yes') allergies = '';

    const mealRaw = record.meal;
    if (mealRaw !== null && mealRaw !== undefined && typeof mealRaw !== 'string') {
      return { state, result: { ok: false, error: 'invalid' } };
    }
    let meal = typeof mealRaw === 'string' ? mealRaw.trim() : '';
    if (!state.wedding.meal_enabled || record.status !== 'yes') {
      meal = '';
    } else if (!state.wedding.meal_options.some((option) => option.id === meal)) {
      return { state, result: { ok: false, error: 'invalid' } };
    }

    clean.push({
      id: record.id,
      name,
      status: record.status,
      meal: meal || null,
      allergies: allergies || null,
    });
  }

  const messageText = typeof message === 'string' ? message.trim() : '';
  const updatedGuests: GuestRecord[] = invite.guests.map((guest) => {
    const incoming = clean.find((item) => item.id === guest.id);
    if (!incoming) return { ...guest };
    return {
      ...guest,
      name: incoming.name,
      status: incoming.status,
      meal: incoming.meal,
      allergies: incoming.allergies,
      updated_at: now.toISOString(),
    };
  });

  const next: State = {
    wedding: state.wedding,
    invites: state.invites.map((item) =>
      item.id === invite.id
        ? { ...item, guests: updatedGuests, message: messageText || null }
        : item,
    ),
  };
  const saved = next.invites.find((item) => item.id === invite.id)!;
  return { state: next, result: { ok: true, payload: toPayload(next, saved) } };
}

export const ADMIN_ATTEMPT_LIMIT = 5;

export function passphraseMatches(pin: string | null | undefined, expectedPin: string): boolean {
  if (typeof pin !== 'string' || typeof expectedPin !== 'string') return false;
  if (pin.length < 12 || pin.length > 72) return false;
  if (pin.trim().length < 12 || expectedPin.length < 12) return false;
  return pin === expectedPin;
}

export function adminLockout(
  recentFailures: number,
  passphraseOk: boolean,
): { ok: true } | { ok: false; error: 'locked' } | { ok: false; error: 'wrong_passphrase'; remaining: number } {
  if (recentFailures >= ADMIN_ATTEMPT_LIMIT) return { ok: false, error: 'locked' };
  if (passphraseOk) return { ok: true };
  return {
    ok: false,
    error: 'wrong_passphrase',
    remaining: Math.max(0, ADMIN_ATTEMPT_LIMIT - (recentFailures + 1)),
  };
}

export function exportGuestName(name: string, isPlusOne: boolean, household: string): string {
  if (isPlusOne && name.trim() === '') return `Acompañante de ${household}`;
  return name;
}

export function unlockAdmin(pin: string | null | undefined, expectedPin: string): boolean {
  return passphraseMatches(pin, expectedPin);
}

function countsOf(state: State): { yes: number; no: number; pending: number } {
  const guests = state.invites.flatMap((invite) => invite.guests);
  return {
    yes: guests.filter((guest) => guest.status === 'yes').length,
    no: guests.filter((guest) => guest.status === 'no').length,
    pending: guests.filter((guest) => guest.status === 'pending').length,
  };
}

export function adminSummary(
  state: State,
  pin: string | null | undefined,
  origin: string,
  basePath: string,
  expectedPin: string,
): AdminSummary | null {
  if (!unlockAdmin(pin, expectedPin)) return null;
  const households: SummaryHousehold[] = state.invites
    .slice()
    .sort((a, b) => a.household_name.localeCompare(b.household_name, 'es'))
    .map((invite) => {
      const pending = invite.guests.some((guest) => guest.status === 'pending');
      const link = inviteLink(origin, basePath, invite.token);
      const text = reminderText(invite.lang, invite.household_name, state.wedding.couple_names, link);
      return {
        household_name: invite.household_name,
        lang: invite.lang,
        pending,
        whatsapp_url: pending ? whatsappReminder(text) : null,
        guests: invite.guests.map((guest) => ({
          name: guest.name,
          status: guest.status,
          meal: guest.meal,
          allergies: guest.allergies,
          is_plus_one: guest.is_plus_one,
        })),
      };
    });
  return {
    couple_names: state.wedding.couple_names,
    wedding_date: state.wedding.wedding_date,
    venue_name: state.wedding.venue_name,
    rsvp_deadline: state.wedding.rsvp_deadline,
    counts: countsOf(state),
    households,
  };
}

export function adminExport(
  state: State,
  pin: string | null | undefined,
  expectedPin: string,
): ExportRow[] | null {
  if (!unlockAdmin(pin, expectedPin)) return null;
  return state.invites
    .slice()
    .sort((a, b) => a.household_name.localeCompare(b.household_name, 'es'))
    .flatMap((invite) =>
      invite.guests.map((guest) => ({
        household_name: invite.household_name,
        guest_name: exportGuestName(guest.name, guest.is_plus_one, invite.household_name),
        status: guest.status,
        meal: guest.meal,
        allergies: guest.allergies,
        is_plus_one: guest.is_plus_one,
      })),
    );
}
