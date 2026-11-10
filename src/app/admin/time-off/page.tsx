import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { listAdminPractitioners } from '@/server/admin/bookings';
import { requireAdmin } from '@/server/admin/context';
import { listCurrentTimeOff, MAX_REASON_LENGTH, MAX_TIME_OFF_DAYS, type TimeOffView } from '@/server/admin/time-off';
import { loadClinicSettings } from '@/server/settings';
import { single, type SearchParams } from '../../messages';
import { addTimeOffAction, removeTimeOffAction } from './actions';

const ERRORS: Record<string, string> = {
  invalid: 'Choose a practitioner and enter a valid start and end. Reasons can be up to 200 characters.',
  end_before_start: 'The end must be after the start.',
  already_over: 'That period has already ended. Enter time off that ends in the future.',
  too_long: `Time off can be at most ${MAX_TIME_OFF_DAYS} days at once. Add a longer absence in parts.`,
  unknown_practitioner: 'That practitioner could not be found.',
  not_found: 'That time off has already been removed.',
  unavailable: 'Time off could not be saved. Please try again.',
};

function AffectedBookings({ block, timeZone }: { block: TimeOffView; timeZone: string }) {
  if (block.affectedBookings.length === 0) {
    return (
      <p className="text-sm" data-testid="time-off-no-bookings">
        No booked appointments in this time.
      </p>
    );
  }
  return (
    <div className="alert" role="alert" data-testid="time-off-warning">
      <p className="font-medium">
        {block.affectedBookings.length} booked{' '}
        {block.affectedBookings.length === 1 ? 'appointment is' : 'appointments are'} in this time. They have not been
        cancelled; please contact {block.affectedBookings.length === 1 ? 'the patient' : 'these patients'}.
      </p>
      <ul className="mt-2 list-disc pl-5">
        {block.affectedBookings.map((booking) => (
          <li key={booking.bookingId} data-testid="time-off-affected-booking">
            {formatSlot(booking.startsAt, timeZone)}: {booking.patientName}, {booking.patientEmail}
            {booking.phone ? `, ${booking.phone}` : ', no phone number given'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function AdminTimeOffPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const db = getDatabase();
  const now = getClock().now();
  const [settings, practitioners, blocks, params] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    listCurrentTimeOff(db, now),
    searchParams,
  ]);
  const error = single(params.error);
  const createdId = single(params.created);
  const created = blocks.find((block) => block.id === createdId);
  return (
    <section>
      <h1>Practitioner time off</h1>
      <p>
        <Link href="/admin" prefetch={false} className="underline">
          Back to bookings
        </Link>
      </p>
      <p className="mt-4 text-sm">
        Block out time when a practitioner is away. Patients are not offered any appointment that overlaps it. Existing
        bookings are kept, and are listed so you can contact the patients.
      </p>
      {created ? (
        <div data-testid="time-off-created">
          <p role="status" className="notice mt-4">
            Time off saved for {created.practitionerName}.
          </p>
          <AffectedBookings block={created} timeZone={settings.timeZone} />
        </div>
      ) : null}
      {params.removed === '1' ? (
        <p role="status" className="notice mt-4" data-testid="time-off-removed">
          Time off removed. Those times can be booked again.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert mt-4" data-testid="time-off-error">
          {ERRORS[error] ?? ERRORS.unavailable}
        </p>
      ) : null}

      <h2>Add time off</h2>
      <form action={addTimeOffAction} className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          Practitioner
          <select name="practitionerId" required defaultValue="" data-testid="time-off-practitioner">
            <option value="" disabled>
              Choose a practitioner
            </option>
            {practitioners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start ({settings.timeZone})
          <input type="datetime-local" name="start" required data-testid="time-off-start" />
        </label>
        <label>
          End ({settings.timeZone})
          <input type="datetime-local" name="end" required data-testid="time-off-end" />
        </label>
        <label className="sm:col-span-2">
          Reason (optional, staff only)
          <input
            name="reason"
            maxLength={MAX_REASON_LENGTH}
            placeholder="For example: holiday, training, sick day"
            data-testid="time-off-reason"
          />
        </label>
        <div>
          <button type="submit" className="button" data-testid="time-off-save">
            Block out this time
          </button>
        </div>
      </form>

      <h2>Upcoming and current time off</h2>
      {blocks.length === 0 ? (
        <p data-testid="time-off-empty">No time off is booked.</p>
      ) : (
        <ul className="space-y-4">
          {blocks.map((block) => (
            <li key={block.id} className="rounded border border-slate-200 p-4" data-testid="time-off-row">
              <p className="font-medium">{block.practitionerName}</p>
              <p className="text-sm">
                From {formatSlot(block.startsAt, settings.timeZone)} to {formatSlot(block.endsAt, settings.timeZone)}
                {block.reason ? ` · ${block.reason}` : ''}
              </p>
              <div className="mt-2">
                <AffectedBookings block={block} timeZone={settings.timeZone} />
              </div>
              <form action={removeTimeOffAction} className="mt-2">
                <input type="hidden" name="timeOffId" value={block.id} />
                <button type="submit" className="button-secondary" data-testid="time-off-remove">
                  Remove this time off
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
