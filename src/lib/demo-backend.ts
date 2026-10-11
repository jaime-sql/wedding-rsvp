import { DEMO_PIN, createInitialState, type DemoState } from './demo-data';
import { adminExport, adminSummary, applySubmit, getInvite } from './rsvp';
import type { AdminSummary, ExportRow, InvitePayload, SubmitResult } from './types';

const STORAGE_KEY = 'wedding-rsvp-demo-v1';

export interface DemoStorage {
  read(): string | null;
  write(value: string): void;
}

export function browserStorage(): DemoStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const storage = localStorage;
    return {
      read: () => storage.getItem(STORAGE_KEY),
      write: (value) => storage.setItem(STORAGE_KEY, value),
    };
  } catch {
    return null;
  }
}

function loadState(storage: DemoStorage | null): DemoState {
  if (!storage) return createInitialState();
  const raw = storage.read();
  if (!raw) return createInitialState();
  try {
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed?.wedding?.id || !Array.isArray(parsed.invites)) return createInitialState();
    return parsed;
  } catch {
    return createInitialState();
  }
}

export interface DemoApi {
  getInvite(token: string | null): InvitePayload | null;
  submit(token: string, guests: unknown, message: string | null, now?: Date): SubmitResult;
  adminSummary(pin: string, origin: string, basePath: string): AdminSummary | null;
  adminExport(pin: string): ExportRow[] | null;
}

export function createDemoApi(storage: DemoStorage | null = null): DemoApi {
  let state = loadState(storage);
  const persist = (next: DemoState) => {
    state = next;
    storage?.write(JSON.stringify(next));
  };

  return {
    getInvite(token) {
      return getInvite(state, token);
    },
    submit(token, guests, message, now = new Date()) {
      const outcome = applySubmit(state, token, guests, message, now);
      if (outcome.result.ok) persist(outcome.state);
      return outcome.result;
    },
    adminSummary(pin, origin, basePath) {
      return adminSummary(state, pin, origin, basePath, DEMO_PIN);
    },
    adminExport(pin) {
      return adminExport(state, pin, DEMO_PIN);
    },
  };
}

let singleton: DemoApi | null = null;

export function demoApi(): DemoApi {
  if (!singleton) singleton = createDemoApi(browserStorage());
  return singleton;
}
