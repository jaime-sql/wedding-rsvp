import type { Lang } from './i18n';
import type { ExportRow, GuestRecord, MealOption, RsvpStatus, WeddingInfo } from './types';

export const DEMO_PASSPHRASE = 'hacienda-demo';
export const DEMO_PIN = DEMO_PASSPHRASE;
export const DEMO_WEDDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const PUBLIC_SITE = 'https://jaime-sql.github.io/wedding-rsvp';

export const TOKENS = {
  garcia: 'K7mQ2pL9xR4nW8vT3cY6hJd',
  lopez: 'N3sD8fH1jM6qP0wZ5yC2uBx',
  martin: 'R9tG4kB7vL2xS5nJ8mQ1eAm',
} as const;

export const MEAL_OPTIONS: MealOption[] = [
  { id: 'carne', es: 'Carne', en: 'Meat' },
  { id: 'pescado', es: 'Pescado', en: 'Fish' },
  { id: 'vegetariano', es: 'Vegetariano', en: 'Vegetarian' },
];

export interface DemoInvite {
  id: string;
  household_name: string;
  token: string;
  seats_allowed: number;
  lang: Lang;
  guests: GuestRecord[];
  message: string | null;
}

export interface DemoState {
  wedding: WeddingInfo;
  invites: DemoInvite[];
}

function guest(
  id: string,
  name: string,
  isPlusOne: boolean,
  status: RsvpStatus,
  position: number,
  allergies: string | null = null,
): GuestRecord & { position: number } {
  return {
    id,
    name,
    is_plus_one: isPlusOne,
    status,
    meal: null,
    allergies,
    updated_at: '2026-01-01T00:00:00.000Z',
    position,
  };
}

const garciaGuests = [
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Lucía García', false, 'pending', 1),
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'Pablo García', false, 'pending', 2),
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '', true, 'pending', 3),
];

const lopezGuests = [
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'Marta López', false, 'yes', 1, 'frutos secos'),
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc5', 'Andrés López', false, 'yes', 2),
];

const martinGuests = [
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc6', 'Sofía Martín', false, 'no', 1),
  guest('cccccccc-cccc-4ccc-8ccc-ccccccccccc7', '', true, 'pending', 2),
];

function withoutPosition(rows: Array<GuestRecord & { position: number }>): GuestRecord[] {
  return rows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      id: row.id,
      name: row.name,
      is_plus_one: row.is_plus_one,
      status: row.status,
      meal: row.meal,
      allergies: row.allergies,
      updated_at: row.updated_at,
    }));
}

export function createInitialState(): DemoState {
  const wedding: WeddingInfo = {
    id: DEMO_WEDDING_ID,
    couple_names: 'Diana y Marcelo',
    wedding_date: '2026-12-05',
    venue_name: 'Hacienda Los Olivos (DEMO)',
    address: 'Ctra. de Carmona km 4, Sevilla (DEMO)',
    map_url: 'https://maps.google.com/?q=Hacienda+Los+Olivos+Sevilla',
    rsvp_deadline: '2026-11-15T05:59:00.000Z',
    meal_enabled: false,
    meal_options: MEAL_OPTIONS.map((option) => ({ ...option })),
    default_lang: 'es',
  };

  const invites: DemoInvite[] = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      household_name: 'García',
      token: TOKENS.garcia,
      seats_allowed: 3,
      lang: 'es',
      guests: withoutPosition(garciaGuests),
      message: null,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      household_name: 'López',
      token: TOKENS.lopez,
      seats_allowed: 2,
      lang: 'es',
      guests: withoutPosition(lopezGuests),
      message: '¡Allí estaremos!',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
      household_name: 'Martín',
      token: TOKENS.martin,
      seats_allowed: 2,
      lang: 'en',
      guests: withoutPosition(martinGuests),
      message: null,
    },
  ];

  return { wedding, invites };
}

export function sampleMarks(venueName: string): boolean {
  return venueName.includes('(DEMO)');
}

export type { ExportRow };
