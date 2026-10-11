import { fetchInvite, sendRsvp } from '../lib/api';
import { buildIcs } from '../lib/ics';
import { readLang, t, writeLang, type Lang, type MessageKey } from '../lib/i18n';
import {
  attendingCount,
  formatDeadline,
  formatPlaces,
  formatWeddingDate,
  replySummary,
  seatsForFamily,
  hasUnanswered,
  isAcceptableToken,
  isPastDeadline,
  mealLabel,
  missingMeal,
  missingPlusOneName,
  safeHttpUrl,
  sampleMarks,
  showPlusOneName,
  tokenProblem,
} from '../lib/rsvp';
import type { GuestInput, GuestRecord, InvitePayload, RsvpStatus, SubmitError } from '../lib/types';
import { downloadText, escapeHtml } from './download';

type Step = 'loading' | 'error' | 'welcome' | 'who' | 'details' | 'review' | 'thanks' | 'closed';
type Problem = 'missing' | 'invalid' | 'load';

function applyDocument(lang: Lang, title: string): void {
  document.documentElement.lang = lang;
  document.title = title;
  writeLang(lang);
  const strip = document.getElementById('demo-strip');
  if (strip) strip.textContent = t(lang, 'demoStrip');
  const skip = document.querySelector('[data-i18n="skip"]');
  if (skip) skip.textContent = t(lang, 'skip');
}

function statusKey(status: RsvpStatus): MessageKey {
  if (status === 'yes') return 'yes';
  if (status === 'no') return 'no';
  return 'pending';
}

export function mountInvite(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  let lang = readLang();
  let step: Step = 'loading';
  let problem: Problem = 'invalid';
  let payload: InvitePayload | null = null;
  let guests: GuestRecord[] = [];
  let message = '';
  let formError = '';
  let busy = false;
  let focusSelector: string | null = null;

  const answered = () => guests.some((guest) => guest.status !== 'pending');
  const closed = () =>
    payload !== null && isPastDeadline(payload.wedding.rsvp_deadline, new Date());

  const render = () => {
    const title = payload
      ? `${payload.wedding.couple_names} · ${t(lang, 'docTitleInvite')}`
      : t(lang, 'docTitleInvite');
    applyDocument(lang, title);
    root.innerHTML = view();
    if (focusSelector) {
      const target = root.querySelector(focusSelector);
      if (target instanceof HTMLElement) target.focus();
      focusSelector = null;
    }
  };

  const view = (): string => {
    if (step === 'loading') {
      return `${chrome()}<main><p role="status">${escapeHtml(t(lang, 'loading'))}</p></main>`;
    }
    if (step === 'error' || !payload) {
      const titleKey = problem === 'missing' ? 'missingTitle' : problem === 'load' ? 'loadError' : 'invalidTitle';
      const bodyKey = problem === 'missing' ? 'missingBody' : problem === 'load' ? 'loadError' : 'invalidBody';
      return `${chrome()}<main><h1>${escapeHtml(t(lang, titleKey))}</h1><p class="lede">${escapeHtml(t(lang, bodyKey))}</p></main>`;
    }
    if (step === 'closed') return closedView(payload);
    if (step === 'who') return whoView(payload);
    if (step === 'details') return detailsView(payload);
    if (step === 'review') return reviewView(payload);
    if (step === 'thanks') return thanksView(payload);
    return welcomeView(payload);
  };

  const chrome = (couple?: string, compact = false): string => {
    const brand = couple
      ? `<p class="couple${compact ? ' compact' : ''}">${escapeHtml(couple)}</p>`
      : '';
    return `<header class="top">${langSwitch()}</header>${brand}`;
  };

  const langSwitch = (): string => `
    <div class="langs" role="group" aria-label="${escapeHtml(t(lang, 'langGroup'))}">
      <button type="button" data-action="lang" data-lang="es" aria-pressed="${lang === 'es'}">${escapeHtml(t(lang, 'langEs'))}</button>
      <button type="button" data-action="lang" data-lang="en" aria-pressed="${lang === 'en'}">${escapeHtml(t(lang, 'langEn'))}</button>
    </div>`;

  const mark = (venue: string): string =>
    sampleMarks(venue) ? `<span class="demo-mark">${escapeHtml(t(lang, 'demoMark'))}</span>` : '';

  const errorBlock = (): string =>
    formError ? `<p class="alert" role="alert">${escapeHtml(formError)}</p>` : '';

  const dock = (label: string, action: string, note = ''): string => `
    <div class="dock">
      ${note ? `<p class="seat-note">${escapeHtml(note)}</p>` : ''}
      <button type="button" class="btn" id="primary-action" data-action="${action}" ${busy ? 'disabled' : ''}>${escapeHtml(label)}</button>
    </div>`;

  const back = (): string =>
    `<button type="button" class="linkish" data-action="back">${escapeHtml(t(lang, 'back'))}</button>`;

  const welcomeView = (data: InvitePayload): string => {
    const wedding = data.wedding;
    const map = safeHttpUrl(wedding.map_url);
    const responded = answered();
    return `
      ${chrome()}
      <main>
        <h1 class="couple">${escapeHtml(wedding.couple_names)}</h1>
        <p class="hello">${escapeHtml(t(lang, 'hello', { household: data.household.household_name }))}</p>
        <div class="stack">
          <p><span class="label">${escapeHtml(t(lang, 'dateLabel'))}</span> ${escapeHtml(formatWeddingDate(wedding.wedding_date, lang))}${mark(wedding.venue_name)}</p>
          <p>
            <span class="label">${escapeHtml(t(lang, 'venueLabel'))}</span>
            ${escapeHtml(wedding.venue_name)}<br>
            ${escapeHtml(wedding.address)}<br>
            ${map ? `<a class="map-link" href="${escapeHtml(map)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(t(lang, 'mapLink'))}<span class="sr-only"> (${escapeHtml(t(lang, 'newTab'))})</span></a>` : ''}
          </p>
          <p><span class="label">${escapeHtml(t(lang, 'deadlineLabel'))}</span> ${escapeHtml(formatDeadline(wedding.rsvp_deadline, lang))}${mark(wedding.venue_name)}</p>
        </div>
        ${responded ? `<p class="alert" role="status">${escapeHtml(t(lang, 'already'))}</p>` : ''}
      </main>
      ${dock(
        responded ? t(lang, 'changeCta') : t(lang, 'confirmCta'),
        'start',
        seatsForFamily(data.household.seats_allowed, lang),
      )}`;
  };

  const seatRows = (): string =>
    guests
      .map((guest) => {
        const title = guest.is_plus_one ? t(lang, 'plusOneLabel') : guest.name;
        const nameField = showPlusOneName(guest)
          ? `<label class="field" for="name-${escapeHtml(guest.id)}">${escapeHtml(t(lang, 'plusOneName'))}
              <input id="name-${escapeHtml(guest.id)}" data-field="name" data-id="${escapeHtml(guest.id)}" type="text" maxlength="80" autocomplete="name" value="${escapeHtml(guest.name)}">
            </label>`
          : '';
        return `<div class="seat">
          <p class="seat-name" id="seat-${escapeHtml(guest.id)}">${escapeHtml(title)}</p>
          <div class="choices" role="group" aria-labelledby="seat-${escapeHtml(guest.id)}">
            <button type="button" class="choice" id="choice-yes-${escapeHtml(guest.id)}" data-action="yes" data-id="${escapeHtml(guest.id)}" aria-pressed="${guest.status === 'yes'}">${escapeHtml(t(lang, 'yes'))}</button>
            <button type="button" class="choice" id="choice-no-${escapeHtml(guest.id)}" data-action="no" data-id="${escapeHtml(guest.id)}" aria-pressed="${guest.status === 'no'}">${escapeHtml(t(lang, 'no'))}</button>
          </div>
          ${nameField}
        </div>`;
      })
      .join('');

  const whoView = (data: InvitePayload): string => `
    ${chrome(data.wedding.couple_names, true)}
    <main>
      ${back()}
      <h1>${escapeHtml(t(lang, 'comingTitle'))}</h1>
      <p class="counter" id="seat-counter" aria-live="polite">${escapeHtml(formatPlaces(attendingCount(guests), data.household.seats_allowed, lang))}</p>
      ${errorBlock()}
      ${seatRows()}
    </main>
    ${dock(t(lang, 'continue'), 'continue-who')}`;

  const yesGuests = (): GuestRecord[] => guests.filter((guest) => guest.status === 'yes');

  const detailsView = (data: InvitePayload): string => {
    const mealOn = data.wedding.meal_enabled;
    const blocks = yesGuests()
      .map((guest) => {
        const name = guest.is_plus_one ? guest.name || t(lang, 'plusOneLabel') : guest.name;
        const meal = mealOn
          ? `<label class="field" for="meal-${escapeHtml(guest.id)}">${escapeHtml(t(lang, 'mealLabel', { name }))}
              <select id="meal-${escapeHtml(guest.id)}" data-field="meal" data-id="${escapeHtml(guest.id)}">
                <option value="">${escapeHtml(t(lang, 'mealChoose'))}</option>
                ${data.wedding.meal_options
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option.id)}" ${guest.meal === option.id ? 'selected' : ''}>${escapeHtml(lang === 'en' ? option.en : option.es)}</option>`,
                  )
                  .join('')}
              </select>
            </label>`
          : '';
        return `<div class="seat">
          ${meal}
          <label class="field" for="allergy-${escapeHtml(guest.id)}">${escapeHtml(t(lang, 'allergiesLabel', { name }))}
            <span class="muted"> ${escapeHtml(t(lang, 'allergiesHint'))}</span>
            <input id="allergy-${escapeHtml(guest.id)}" data-field="allergies" data-id="${escapeHtml(guest.id)}" type="text" maxlength="300" value="${escapeHtml(guest.allergies ?? '')}">
          </label>
        </div>`;
      })
      .join('');
    return `
      ${chrome(data.wedding.couple_names, true)}
      <main>
        ${back()}
        <h1>${escapeHtml(t(lang, mealOn ? 'detailsTitleMeal' : 'detailsTitle'))}</h1>
        ${errorBlock()}
        ${blocks}
        <label class="field" for="message">${escapeHtml(t(lang, 'messageLabel'))}
          <span class="muted"> ${escapeHtml(t(lang, 'messageHint'))}</span>
          <textarea id="message" data-field="message" maxlength="2000">${escapeHtml(message)}</textarea>
        </label>
      </main>
      ${dock(t(lang, 'continue'), 'continue-details')}`;
  };

  const personLine = (guest: GuestRecord, data: InvitePayload): string => {
    const name = guest.name || t(lang, 'plusOneLabel');
    const bits = [escapeHtml(name)];
    const meal = mealLabel(data.wedding.meal_options, guest.meal, lang);
    if (meal) bits.push(escapeHtml(t(lang, 'reviewMeal', { value: meal })));
    if (guest.allergies) bits.push(escapeHtml(t(lang, 'reviewAllergies', { value: guest.allergies })));
    return `<li>${bits.join(' · ')}</li>`;
  };

  const reviewView = (data: InvitePayload): string => {
    const coming = yesGuests();
    const staying = guests.filter((guest) => guest.status === 'no');
    const list = (rows: GuestRecord[], empty: string) =>
      rows.length
        ? `<ul class="plain">${rows.map((guest) => personLine(guest, data)).join('')}</ul>`
        : `<p>${escapeHtml(empty)}</p>`;
    return `
      ${chrome(data.wedding.couple_names, true)}
      <main>
        ${back()}
        <h1>${escapeHtml(t(lang, 'reviewTitle'))}</h1>
        ${errorBlock()}
        <section class="review-block">
          <h2>${escapeHtml(t(lang, 'comingList'))}</h2>
          ${list(coming, t(lang, 'nobody'))}
        </section>
        <section class="review-block">
          <h2>${escapeHtml(t(lang, 'notComingList'))}</h2>
          ${list(staying, t(lang, 'nobody'))}
        </section>
        <section class="review-block">
          <h2>${escapeHtml(t(lang, 'messageLabel'))}</h2>
          <p>${message.trim() ? escapeHtml(message) : escapeHtml(t(lang, 'dash'))}</p>
        </section>
      </main>
      ${dock(busy ? t(lang, 'sending') : t(lang, 'send'), 'send')}`;
  };

  const thanksView = (data: InvitePayload): string => {
    const wedding = data.wedding;
    const change = closed()
      ? ''
      : `<div class="confirm-actions"><button type="button" class="btn" id="primary-action" data-action="change">${escapeHtml(t(lang, 'changeCta'))}</button></div>`;
    const calendar = yesGuests().length
      ? `<p class="calendar-row"><button type="button" class="btn secondary" data-action="calendar">${escapeHtml(t(lang, 'addCalendar'))}</button></p>`
      : '';
    return `
    ${chrome(wedding.couple_names, true)}
    <main>
      <h1>${escapeHtml(t(lang, 'thanksTitle'))}</h1>
      <p class="reply-summary">${escapeHtml(replySummary(guests, lang))}</p>
      <div class="stack">
        <p><span class="label">${escapeHtml(t(lang, 'dateLabel'))}</span> ${escapeHtml(formatWeddingDate(wedding.wedding_date, lang))}${mark(wedding.venue_name)}</p>
        <p><span class="label">${escapeHtml(t(lang, 'venueLabel'))}</span> ${escapeHtml(wedding.venue_name)}</p>
      </div>
      ${change}
      ${calendar}
    </main>`;
  };

  const readonlyList = (): string => {
    if (!answered()) return `<p class="alert" role="status">${escapeHtml(t(lang, 'noReply'))}</p>`;
    return `<ul class="plain">${guests
      .map((guest) => {
        const name = guest.name || t(lang, 'plusOneLabel');
        return `<li>${escapeHtml(name)} · ${escapeHtml(t(lang, statusKey(guest.status)))}</li>`;
      })
      .join('')}</ul>`;
  };

  const closedView = (data: InvitePayload): string => `
    ${chrome()}
    <main>
      <h1 class="couple">${escapeHtml(data.wedding.couple_names)}</h1>
      <p class="hello">${escapeHtml(t(lang, 'hello', { household: data.household.household_name }))}</p>
      <p class="alert" role="status">${escapeHtml(t(lang, 'deadlineNotice'))}</p>
      ${readonlyList()}
      ${yesGuests().length ? `<p style="margin-top:16px"><button type="button" class="btn secondary" data-action="calendar">${escapeHtml(t(lang, 'addCalendar'))}</button></p>` : ''}
    </main>`;

  const inputs = (): GuestInput[] =>
    guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      status: guest.status,
      meal: guest.meal,
      allergies: guest.allergies,
    }));

  const fail = (error: SubmitError | 'generic') => {
    if (error === 'deadline' && payload && isPastDeadline(payload.wedding.rsvp_deadline, new Date())) {
      step = 'closed';
      formError = '';
      return;
    }
    const key =
      error === 'deadline' ? 'errorDeadline' : error === 'seats' ? 'errorSeats' : error === 'invalid' ? 'errorInvalid' : 'errorGeneric';
    formError = t(lang, key);
    step = 'review';
  };

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const control = target.closest<HTMLElement>('[data-action]');
    if (!control || busy) return;
    const action = control.dataset.action;
    if (action === 'lang') {
      const next = control.dataset.lang;
      if (next === 'es' || next === 'en') {
        lang = next;
        render();
      }
      return;
    }
    if (action === 'yes' || action === 'no') {
      const guest = guests.find((item) => item.id === control.dataset.id);
      if (!guest) return;
      guest.status = action;
      if (action === 'no') {
        guest.meal = null;
        guest.allergies = null;
      }
      formError = '';
      focusSelector =
        guest.is_plus_one && action === 'yes'
          ? `#name-${CSS.escape(guest.id)}`
          : `#choice-${action}-${CSS.escape(guest.id)}`;
      render();
      return;
    }
    if (action === 'start') {
      step = 'who';
      formError = '';
      render();
      return;
    }
    if (action === 'back') {
      formError = '';
      if (step === 'who') step = 'welcome';
      else if (step === 'details') step = 'who';
      else if (step === 'review') step = 'details';
      render();
      return;
    }
    if (action === 'continue-who') {
      if (hasUnanswered(guests)) formError = t(lang, 'needChoice');
      else if (missingPlusOneName(guests)) formError = t(lang, 'plusOneNameRequired');
      else {
        formError = '';
        step = 'details';
      }
      render();
      return;
    }
    if (action === 'continue-details') {
      if (payload && missingMeal(payload.wedding.meal_enabled, guests)) formError = t(lang, 'mealRequired');
      else {
        formError = '';
        step = 'review';
      }
      render();
      return;
    }
    if (action === 'send') {
      if (!token || !isAcceptableToken(token)) return;
      busy = true;
      formError = '';
      render();
      void sendRsvp(token, inputs(), message.trim() || null)
        .then((result) => {
          busy = false;
          if (!result.ok) {
            fail(result.error);
            render();
            return;
          }
          payload = result.payload;
          guests = result.payload.guests.map((guest) => ({ ...guest }));
          message = result.payload.message ?? '';
          step = isPastDeadline(result.payload.wedding.rsvp_deadline, new Date()) ? 'closed' : 'thanks';
          render();
        })
        .catch(() => {
          busy = false;
          fail('generic');
          render();
        });
      return;
    }
    if (action === 'calendar' && payload) {
      downloadText(t(lang, 'calendarFile'), buildIcs(payload.wedding), 'text/calendar;charset=utf-8');
      return;
    }
    if (action === 'change' && !closed()) {
      step = 'who';
      formError = '';
      render();
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const field = target.dataset.field;
    const id = target.dataset.id;
    if (field === 'message') message = target.value;
    if (!id) return;
    const guest = guests.find((item) => item.id === id);
    if (!guest) return;
    if (field === 'name') guest.name = target.value;
    if (field === 'allergies') guest.allergies = target.value.trim() ? target.value : null;
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.field !== 'meal' || !target.dataset.id) return;
    const guest = guests.find((item) => item.id === target.dataset.id);
    if (!guest) return;
    guest.meal = target.value || null;
  });

  const boot = async () => {
    const issue = tokenProblem(token);
    if (issue || !token) {
      problem = issue ?? 'missing';
      step = 'error';
      render();
      return;
    }
    try {
      const result = await fetchInvite(token);
      if (!result) {
        problem = 'invalid';
        step = 'error';
        render();
        return;
      }
      payload = result;
      guests = result.guests.map((guest) => ({ ...guest }));
      message = result.message ?? '';
      step = isPastDeadline(result.wedding.rsvp_deadline, new Date()) ? 'closed' : 'welcome';
      render();
    } catch {
      problem = 'load';
      step = 'error';
      render();
    }
  };

  void boot();
}
