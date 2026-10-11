import type { Lang } from './i18n';

export type RsvpStatus = 'pending' | 'yes' | 'no';

export interface MealOption {
  id: string;
  es: string;
  en: string;
}

export interface WeddingInfo {
  id: string;
  couple_names: string;
  wedding_date: string;
  venue_name: string;
  address: string;
  map_url: string;
  rsvp_deadline: string;
  meal_enabled: boolean;
  meal_options: MealOption[];
  default_lang: Lang;
}

export interface HouseholdInfo {
  id: string;
  household_name: string;
  seats_allowed: number;
  lang: Lang;
}

export interface GuestRecord {
  id: string;
  name: string;
  is_plus_one: boolean;
  status: RsvpStatus;
  meal: string | null;
  allergies: string | null;
  updated_at: string;
}

export interface InvitePayload {
  wedding: WeddingInfo;
  household: HouseholdInfo;
  guests: GuestRecord[];
  message: string | null;
}

export interface GuestInput {
  id: string;
  name: string;
  status: RsvpStatus;
  meal: string | null;
  allergies: string | null;
}

export type SubmitError = 'not_found' | 'deadline' | 'seats' | 'invalid';

export type SubmitResult =
  | { ok: true; payload: InvitePayload }
  | { ok: false; error: SubmitError };

export interface SummaryGuest {
  name: string;
  status: RsvpStatus;
  meal: string | null;
  allergies: string | null;
  is_plus_one: boolean;
}

export interface SummaryHousehold {
  household_name: string;
  lang: Lang;
  pending: boolean;
  whatsapp_url: string | null;
  guests: SummaryGuest[];
}

export interface AdminSummary {
  couple_names: string;
  wedding_date: string;
  venue_name: string;
  rsvp_deadline: string;
  counts: { yes: number; no: number; pending: number };
  households: SummaryHousehold[];
}

export interface ExportRow {
  household_name: string;
  guest_name: string;
  status: RsvpStatus;
  meal: string | null;
  allergies: string | null;
  is_plus_one: boolean;
}
