import type { WeddingInfo } from './types';

function icsEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let index = 73;
  while (index < line.length) {
    parts.push(` ${line.slice(index, index + 72)}`);
    index += 72;
  }
  return parts.join('\r\n');
}

function stamp(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function nextDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

export function buildIcs(wedding: WeddingInfo, now = new Date()): string {
  const start = wedding.wedding_date.slice(0, 10).replaceAll('-', '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//wedding-rsvp//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${wedding.id}@wedding-rsvp`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${nextDate(wedding.wedding_date)}`,
    `SUMMARY:${icsEscape(wedding.couple_names)}`,
    `LOCATION:${icsEscape(`${wedding.venue_name}, ${wedding.address}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];
  return lines.map(fold).join('\r\n');
}
