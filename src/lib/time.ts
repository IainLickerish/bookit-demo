// Local dates are 'YYYY-MM-DD' strings and local times 'HH:MM' strings, both
// in a clinic's IANA time zone. Instants are always UTC Date objects.

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(instantMs: number, timeZone: string): WallClock {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instantMs)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Offset of the zone from UTC at the given instant, in milliseconds. */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const wall = wallClockAt(instantMs, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const wholeSecondInstant = Math.floor(instantMs / 1000) * 1000;
  return wallAsUtc - wholeSecondInstant;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseLocalDate(localDate: string): [number, number, number] {
  const match = LOCAL_DATE_PATTERN.exec(localDate);
  if (!match) {
    throw new RangeError(`Not a local date (YYYY-MM-DD): ${localDate}`);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Not a calendar date: ${localDate}`);
  }
  return [year, month, day];
}

export function isLocalDate(value: string): boolean {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function parseLocalTime(localTime: string): [number, number] {
  const match = LOCAL_TIME_PATTERN.exec(localTime);
  if (!match) {
    throw new RangeError(`Not a local time (HH:MM): ${localTime}`);
  }
  return [Number(match[1]), Number(match[2])];
}

export function minutesOfLocalTime(localTime: string): number {
  const [hour, minute] = parseLocalTime(localTime);
  return hour * 60 + minute;
}

export function localTimeFromMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The instant at which the zone's wall clock shows the given local date and
 * time. Returns null for a local time skipped by a clock change. For a local
 * time that occurs twice (clocks going back), returns the earlier instant.
 */
export function zonedTimeToUtc(localDate: string, localTime: string, timeZone: string): Date | null {
  const [year, month, day] = parseLocalDate(localDate);
  const [hour, minute] = parseLocalTime(localTime);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = new Set<number>();
  for (const probe of [wallAsUtc - DAY_MS / 2, wallAsUtc, wallAsUtc + DAY_MS / 2]) {
    candidates.add(wallAsUtc - timeZoneOffsetMs(probe, timeZone));
  }
  const matches = [...candidates]
    .filter((instant) => {
      const wall = wallClockAt(instant, timeZone);
      return (
        wall.year === year && wall.month === month && wall.day === day && wall.hour === hour && wall.minute === minute
      );
    })
    .sort((a, b) => a - b);
  const first = matches[0];
  return first === undefined ? null : new Date(first);
}

export function localDateOf(instant: Date, timeZone: string): string {
  const wall = wallClockAt(instant.getTime(), timeZone);
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

export function addDaysToLocalDate(localDate: string, days: number): string {
  const [year, month, day] = parseLocalDate(localDate);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

/** ISO weekday of a local date: Monday is 1, Sunday is 7. */
export function isoWeekday(localDate: string): number {
  const [year, month, day] = parseLocalDate(localDate);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The first instant of a local date in the zone. */
export function startOfLocalDate(localDate: string, timeZone: string): Date {
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const instant = zonedTimeToUtc(localDate, localTimeFromMinutes(minutes), timeZone);
    if (instant) {
      return instant;
    }
  }
  throw new RangeError(`No wall-clock time exists on ${localDate} in ${timeZone}`);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS);
}

export function addHours(instant: Date, hours: number): Date {
  return addMinutes(instant, hours * 60);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}

const slotFormatters = new Map<string, Intl.DateTimeFormat>();

/** A slot's start as patients see it, in the clinic's time zone. */
export function formatSlot(utc: Date, timeZone: string): string {
  let formatter = slotFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    slotFormatters.set(timeZone, formatter);
  }
  return formatter.format(utc);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatLocalTime(utc: Date, timeZone: string): string {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatters.set(timeZone, formatter);
  }
  return formatter.format(utc);
}

export function formatLocalDate(localDate: string): string {
  const [year, month, day] = parseLocalDate(localDate);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
