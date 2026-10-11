import { demoMode, fetchAdminExport, fetchAdminSummary } from '../lib/api';
import { guestsToCsv } from '../lib/csv';
import { adminAuthMessage, readLang, t, writeLang, type Lang } from '../lib/i18n';
import { formatDeadline, formatWeddingDate, sampleMarks, safeHttpUrl } from '../lib/rsvp';
import type { AdminAuthError, AdminSummary, RsvpStatus, SummaryGuest, SummaryHousehold } from '../lib/types';
import { downloadText, escapeHtml } from './download';

type Filter = 'all' | 'yes' | 'no' | 'pending';

function applyDocument(lang: Lang): void {
  document.documentElement.lang = lang;
  document.title = t(lang, 'docTitleAdmin');
  writeLang(lang);
  const strip = document.getElementById('demo-strip');
  if (strip) strip.textContent = t(lang, 'demoStrip');
  const skip = document.querySelector('[data-i18n="skip"]');
  if (skip) skip.textContent = t(lang, 'skip');
}

function statusLabel(status: RsvpStatus, lang: Lang): string {
  if (status === 'yes') return t(lang, 'yes');
  if (status === 'no') return t(lang, 'no');
  return t(lang, 'pending');
}

export function mountAdmin(root: HTMLElement): void {
  root.classList.add('shell-admin');
  let lang = readLang();
  let pin = '';
  let summary: AdminSummary | null = null;
  let authError: AdminAuthError | null = null;
  let filter: Filter = 'all';
  let busy = false;
  let samplePin = '';

  const render = () => {
    applyDocument(lang);
    root.innerHTML = summary ? resultsView(summary) : loginView();
  };

  const langSwitch = (): string => `
    <div class="langs" role="group" aria-label="${escapeHtml(t(lang, 'langGroup'))}">
      <button type="button" data-action="lang" data-lang="es" aria-pressed="${lang === 'es'}">${escapeHtml(t(lang, 'langEs'))}</button>
      <button type="button" data-action="lang" data-lang="en" aria-pressed="${lang === 'en'}">${escapeHtml(t(lang, 'langEn'))}</button>
    </div>`;

  const authMessage = (): string => {
    if (!authError) return '';
    return adminAuthMessage(lang, authError);
  };

  const loginView = (): string => `
    <header class="top">${langSwitch()}</header>
    <main>
      <h1>${escapeHtml(t(lang, 'adminTitle'))}</h1>
      <p class="lede">${escapeHtml(t(lang, 'adminLead'))}</p>
      ${authError ? `<p class="alert" role="alert">${escapeHtml(authMessage())}</p>` : ''}
      <label class="field" for="pin">${escapeHtml(t(lang, 'pinLabel'))}
        <input id="pin" data-field="pin" type="password" autocomplete="current-password" maxlength="72" value="${escapeHtml(pin)}" ${authError ? 'aria-invalid="true"' : ''}>
      </label>
      ${samplePin ? `<p class="muted" style="margin-top:8px">${escapeHtml(t(lang, 'pinHint', { pin: samplePin }))}</p>` : ''}
    </main>
    <div class="dock">
      <button type="button" class="btn" id="primary-action" data-action="enter" ${busy ? 'disabled' : ''}>${escapeHtml(t(lang, 'enter'))}</button>
    </div>`;

  const mark = (venue: string): string =>
    sampleMarks(venue) ? `<span class="demo-mark">${escapeHtml(t(lang, 'demoMark'))}</span>` : '';

  const visibleGuests = (household: SummaryHousehold): SummaryGuest[] =>
    filter === 'all' ? household.guests : household.guests.filter((guest) => guest.status === filter);

  const visibleHouseholds = (data: AdminSummary): SummaryHousehold[] =>
    data.households
      .map((household) => ({ ...household, guests: visibleGuests(household) }))
      .filter((household) => household.guests.length > 0);

  const resultsView = (data: AdminSummary): string => {
    const rows = visibleHouseholds(data);
    const cards = rows
      .map((household) => {
        const link = safeHttpUrl(household.whatsapp_url);
        const people = household.guests
          .map((guest) => {
            const name = guest.name || t(lang, 'plusOneLabel');
            const extra = [
              guest.allergies ? t(lang, 'reviewAllergies', { value: guest.allergies }) : '',
              guest.meal ? guest.meal : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return `<li class="guest-line"><span>${escapeHtml(name)}</span><span>${escapeHtml(statusLabel(guest.status, lang))}${extra ? ` · ${escapeHtml(extra)}` : ''}</span></li>`;
          })
          .join('');
        const reminder =
          household.pending && link
            ? `<a class="btn" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(t(lang, 'whatsapp'))}<span class="sr-only"> (${escapeHtml(t(lang, 'newTab'))})</span></a>`
            : '';
        return `<article class="hcard"><h2>${escapeHtml(t(lang, 'familyLabel', { household: household.household_name }))}</h2><ul class="plain">${people}</ul>${reminder}</article>`;
      })
      .join('');

    const tableRows = rows
      .map((household) => {
        const link = safeHttpUrl(household.whatsapp_url);
        const reminder =
          household.pending && link
            ? `<a class="btn compact" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(t(lang, 'whatsapp'))}<span class="sr-only"> (${escapeHtml(t(lang, 'newTab'))})</span></a>`
            : escapeHtml(t(lang, 'dash'));
        return household.guests
          .map((guest, index) => {
            const reminderCell =
              index === 0
                ? `<td class="reminder" rowspan="${household.guests.length}">${reminder}</td>`
                : '';
            return `<tr>
            <td>${escapeHtml(household.household_name)}</td>
            <td>${escapeHtml(guest.name || t(lang, 'plusOneLabel'))}</td>
            <td>${escapeHtml(statusLabel(guest.status, lang))}</td>
            <td>${escapeHtml(guest.meal || t(lang, 'dash'))}</td>
            <td>${escapeHtml(guest.allergies || t(lang, 'dash'))}</td>
            <td>${escapeHtml(guest.is_plus_one ? t(lang, 'yes') : t(lang, 'no'))}</td>
            ${reminderCell}
          </tr>`;
          })
          .join('');
      })
      .join('');

    const filters: Filter[] = ['all', 'yes', 'no', 'pending'];
    const filterKeys = {
      all: 'filterAll',
      yes: 'filterYes',
      no: 'filterNo',
      pending: 'filterPending',
    } as const;

    return `
      <header class="top">${langSwitch()}</header>
      <main>
        <h1 class="couple">${escapeHtml(data.couple_names)}</h1>
        <p class="lede">${escapeHtml(t(lang, 'adminTitle'))}</p>
        <div class="stack">
          <p><span class="label">${escapeHtml(t(lang, 'dateLabel'))}</span> ${escapeHtml(formatWeddingDate(data.wedding_date, lang))}</p>
          <p><span class="label">${escapeHtml(t(lang, 'venueLabel'))}</span> ${escapeHtml(data.venue_name)}</p>
          <p><span class="label">${escapeHtml(t(lang, 'deadlineLabel'))}</span> ${escapeHtml(formatDeadline(data.rsvp_deadline, lang))}${mark(data.venue_name)}</p>
        </div>
        <section class="counts" aria-label="${escapeHtml(t(lang, 'adminTitle'))}">
          <article class="count-card"><strong>${data.counts.yes}</strong><span>${escapeHtml(t(lang, 'countsYes'))}</span></article>
          <article class="count-card"><strong>${data.counts.no}</strong><span>${escapeHtml(t(lang, 'countsNo'))}</span></article>
          <article class="count-card"><strong>${data.counts.pending}</strong><span>${escapeHtml(t(lang, 'countsPending'))}</span></article>
        </section>
        <div class="export-row">
          <button type="button" class="btn" id="primary-action" data-action="export">${escapeHtml(t(lang, 'exportCsv'))}</button>
        </div>
        <div class="filters" role="group" aria-label="${escapeHtml(t(lang, 'filterLabel'))}">
          ${filters
            .map(
              (value) =>
                `<button type="button" class="filter" data-action="filter" data-filter="${value}" aria-pressed="${filter === value}">${escapeHtml(t(lang, filterKeys[value]))}</button>`,
            )
            .join('')}
        </div>
        ${rows.length === 0 ? `<p class="alert" role="status">${escapeHtml(t(lang, 'noMatches'))}</p>` : ''}
        <div class="hcards">${cards}</div>
        <table class="guest-table">
          <caption class="sr-only">${escapeHtml(t(lang, 'tableCaption'))}</caption>
          <thead>
            <tr>
              <th scope="col">${escapeHtml(t(lang, 'colHousehold'))}</th>
              <th scope="col">${escapeHtml(t(lang, 'colGuest'))}</th>
              <th scope="col">${escapeHtml(t(lang, 'colStatus'))}</th>
              <th scope="col">${escapeHtml(t(lang, 'colMeal'))}</th>
              <th scope="col">${escapeHtml(t(lang, 'colAllergies'))}</th>
              <th scope="col">${escapeHtml(t(lang, 'colPlusOne'))}</th>
              <th scope="col">${escapeHtml(t(lang, 'whatsapp'))}</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </main>`;
  };

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || busy) return;
    const control = target.closest<HTMLElement>('[data-action]');
    if (!control) return;
    const action = control.dataset.action;
    if (action === 'lang') {
      const next = control.dataset.lang;
      if (next === 'es' || next === 'en') {
        lang = next;
        render();
      }
      return;
    }
    if (action === 'filter') {
      const next = control.dataset.filter;
      if (next === 'all' || next === 'yes' || next === 'no' || next === 'pending') {
        filter = next;
        render();
      }
      return;
    }
    if (action === 'enter') {
      const field = root.querySelector<HTMLInputElement>('#pin');
      pin = field?.value ?? '';
      busy = true;
      authError = null;
      render();
      void fetchAdminSummary(pin)
        .then((result) => {
          busy = false;
          if (!result.ok) {
            summary = null;
            authError = result;
            pin = '';
            render();
            return;
          }
          summary = result.summary;
          authError = null;
          render();
        })
        .catch(() => {
          busy = false;
          summary = null;
          authError = { ok: false, error: 'unavailable' };
          pin = '';
          render();
        });
      return;
    }
    if (action === 'export') {
      void fetchAdminExport(pin).then((result) => {
        if (!result.ok) return;
        downloadText(t(lang, 'csvFile'), guestsToCsv(result.rows, lang), 'text/csv;charset=utf-8');
      });
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.field === 'pin') pin = target.value;
  });

  const boot = async () => {
    if (demoMode) {
      const mod = await import('../lib/demo-data');
      samplePin = mod.DEMO_PASSPHRASE;
    }
    render();
  };

  void boot();
}
