import type { Executor } from '@/db/client';
import type { Clock } from '@/lib/clock';
import { addDaysToLocalDate, isLocalDate, localDateOf, startOfLocalDate } from '@/lib/time';
import { bookingHorizonEnd } from '../bookings/rules';
import { loadClinicSettings, type ClinicSettings } from '../settings';
import { listActivePractitioners, listAvailableSlots, type PractitionerSummary, type SlotView } from './queries';

export interface DayView {
  settings: ClinicSettings;
  practitioners: PractitionerSummary[];
  practitioner: PractitionerSummary | null;
  /** The local date shown, between today and the last bookable date. */
  date: string;
  today: string;
  lastDate: string;
  slots: SlotView[];
}

export interface DayViewRequest {
  practitionerId?: string | undefined;
  date?: string | undefined;
}

/** One practitioner's free slots on one local date, within the horizon. */
export async function loadDayView(db: Executor, clock: Clock, request: DayViewRequest): Promise<DayView> {
  const [settings, practitioners] = await Promise.all([loadClinicSettings(db), listActivePractitioners(db)]);
  const now = clock.now();
  const horizonEnd = bookingHorizonEnd(now, settings);
  const today = localDateOf(now, settings.timeZone);
  const lastDate = localDateOf(horizonEnd, settings.timeZone);
  const practitioner = practitioners.find((p) => p.id === request.practitionerId) ?? practitioners[0] ?? null;
  const date =
    request.date !== undefined && isLocalDate(request.date) && request.date >= today && request.date <= lastDate
      ? request.date
      : today;
  const dayStart = startOfLocalDate(date, settings.timeZone);
  const nextDayStart = startOfLocalDate(addDaysToLocalDate(date, 1), settings.timeZone);
  const slots = practitioner
    ? await listAvailableSlots(db, {
        practitionerId: practitioner.id,
        after: new Date(Math.max(now.getTime(), dayStart.getTime() - 1)),
        until: new Date(Math.min(horizonEnd.getTime(), nextDayStart.getTime() - 1)),
      })
    : [];
  return { settings, practitioners, practitioner, date, today, lastDate, slots };
}
