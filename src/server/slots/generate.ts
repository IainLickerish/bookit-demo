import {
  addDaysToLocalDate,
  isoWeekday,
  localDateOf,
  localTimeFromMinutes,
  minutesOfLocalTime,
  zonedTimeToUtc,
} from '@/lib/time';
import { bookingHorizonEnd } from '../bookings/rules';

export interface SlotTemplate {
  /** ISO weekdays: Monday 1 to Sunday 7. */
  workingDays: readonly number[];
  /** Local wall-clock times, 'HH:MM'. */
  workdayStart: string;
  workdayEnd: string;
  sessionMinutes: number;
  timeZone: string;
}

export interface SlotTimes {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Appointment slots of one practitioner that start after `from` and no later
 * than the booking horizon. Working hours are local wall-clock times in the
 * clinic's zone, so a slot keeps its local time on both sides of a clock change.
 */
export function generateSlotTimes(template: SlotTemplate, from: Date, horizonDays: number): SlotTimes[] {
  const horizonEnd = bookingHorizonEnd(from, { slotHorizonDays: horizonDays });
  const dayStart = minutesOfLocalTime(template.workdayStart);
  const dayEnd = minutesOfLocalTime(template.workdayEnd);
  const lastDate = localDateOf(horizonEnd, template.timeZone);
  const result: SlotTimes[] = [];
  for (let date = localDateOf(from, template.timeZone); date <= lastDate; date = addDaysToLocalDate(date, 1)) {
    if (!template.workingDays.includes(isoWeekday(date))) {
      continue;
    }
    for (let start = dayStart; start + template.sessionMinutes <= dayEnd; start += template.sessionMinutes) {
      const startsAt = zonedTimeToUtc(date, localTimeFromMinutes(start), template.timeZone);
      const endsAt = zonedTimeToUtc(date, localTimeFromMinutes(start + template.sessionMinutes), template.timeZone);
      if (!startsAt || !endsAt || endsAt <= startsAt) {
        continue;
      }
      if (startsAt > from && startsAt <= horizonEnd) {
        result.push({ startsAt, endsAt });
      }
    }
  }
  return result;
}
