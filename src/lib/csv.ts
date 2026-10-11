import { t, type Lang } from './i18n';
import type { ExportRow, RsvpStatus } from './types';

function cell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function statusLabel(status: RsvpStatus, lang: Lang): string {
  if (status === 'yes') return t(lang, 'yes');
  if (status === 'no') return t(lang, 'no');
  return t(lang, 'pending');
}

export function guestsToCsv(rows: ExportRow[], lang: Lang): string {
  const headers = [
    t(lang, 'colHousehold'),
    t(lang, 'colGuest'),
    t(lang, 'colStatus'),
    t(lang, 'colMeal'),
    t(lang, 'colAllergies'),
    t(lang, 'colPlusOne'),
  ];
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.household_name,
        row.guest_name,
        statusLabel(row.status, lang),
        row.meal ?? '',
        row.allergies ?? '',
        row.is_plus_one ? t(lang, 'yes') : t(lang, 'no'),
      ]
        .map(cell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}
