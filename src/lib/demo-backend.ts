import { DEMO_PASSPHRASE, createInitialState, type DemoState } from './demo-data';
import { adminExport, adminLockout, adminSummary, applySubmit, getInvite, passphraseMatches } from './rsvp';
import type { AdminExportResult, AdminSummaryResult, InvitePayload, SubmitResult } from './types';

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

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const recentFailures: number[] = [];

function pruneFailures(now: number): number {
  const fresh = recentFailures.filter((at) => now - at < FAILURE_WINDOW_MS);
  recentFailures.length = 0;
  recentFailures.push(...fresh);
  return recentFailures.length;
}

async function pauseOnFailure(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

export interface DemoApi {
  getInvite(token: string | null): InvitePayload | null;
  submit(token: string, guests: unknown, message: string | null, now?: Date): SubmitResult;
  adminSummary(pin: string, origin: string, basePath: string): Promise<AdminSummaryResult>;
  adminExport(pin: string): Promise<AdminExportResult>;
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
    async adminSummary(pin, origin, basePath) {
      const now = Date.now();
      const decision = adminLockout(pruneFailures(now), passphraseMatches(pin, DEMO_PASSPHRASE));
      if (!decision.ok) {
        if (decision.error === 'wrong_passphrase') {
          recentFailures.push(now);
          await pauseOnFailure();
        }
        return decision;
      }
      const summary = adminSummary(state, pin, origin, basePath, DEMO_PASSPHRASE);
      if (!summary) return { ok: false, error: 'wrong_passphrase', remaining: 0 };
      return { ok: true, summary };
    },
    async adminExport(pin) {
      const now = Date.now();
      const decision = adminLockout(pruneFailures(now), passphraseMatches(pin, DEMO_PASSPHRASE));
      if (!decision.ok) {
        if (decision.error === 'wrong_passphrase') {
          recentFailures.push(now);
          await pauseOnFailure();
        }
        return decision;
      }
      const rows = adminExport(state, pin, DEMO_PASSPHRASE);
      if (!rows) return { ok: false, error: 'wrong_passphrase', remaining: 0 };
      return { ok: true, rows };
    },
  };
}

let singleton: DemoApi | null = null;

export function demoApi(): DemoApi {
  if (!singleton) singleton = createDemoApi(browserStorage());
  return singleton;
}
