import { formatSlot } from './time';

export interface CalendarDetailsInput {
  clinicName: string;
  timeZone: string;
  practitionerName: string;
  startsAt: Date;
  endsAt: Date;
}

/** Only event details belong here, never client data, booking references or private links. */
export function calendarDetails(input: CalendarDetailsInput): string {
  const { clinicName, timeZone, practitionerName, startsAt, endsAt } = input;
  const zoneName = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
    .formatToParts(startsAt)
    .find((part) => part.type === 'timeZoneName')?.value;
  const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  return [
    `Title: ${clinicName} with ${practitionerName}`,
    `Clinic: ${clinicName}`,
    `With: ${practitionerName}`,
    `Start: ${formatSlot(startsAt, timeZone)}`,
    `End: ${formatSlot(endsAt, timeZone)}`,
    `Time zone: ${timeZone} (${zoneName})`,
    `Duration: ${minutes} minutes`,
  ].join('\n');
}
