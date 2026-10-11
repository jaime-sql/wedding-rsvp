import { readLang, t, writeLang, type Lang, type MessageKey } from '../lib/i18n';

export function mountHome(root: ParentNode): void {
  let lang: Lang = readLang();

  const apply = () => {
    document.documentElement.lang = lang;
    document.title = t(lang, 'docTitleHome');
    writeLang(lang);
    const strip = document.getElementById('demo-strip');
    if (strip) strip.textContent = t(lang, 'demoStrip');
    const skip = document.querySelector('[data-i18n="skip"]');
    if (skip) skip.textContent = t(lang, 'skip');
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
      const key = element.dataset.i18n as MessageKey | undefined;
      if (!key) return;
      element.textContent = t(lang, key);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((element) => {
      const key = element.dataset.i18nAria as MessageKey | undefined;
      if (!key) return;
      element.setAttribute('aria-label', t(lang, key));
    });
    root.querySelectorAll<HTMLElement>('[data-family]').forEach((element) => {
      element.textContent = t(lang, 'familyLabel', { household: element.dataset.family ?? '' });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.lang === lang ? 'true' : 'false');
    });
  };

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>('[data-lang]');
    if (!button) return;
    const next = button.dataset.lang;
    if (next === 'es' || next === 'en') {
      lang = next;
      apply();
    }
  });

  apply();
}
