import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { requireAdmin } from '@/server/admin/context';
import { listAdminPractitioners } from '@/server/admin/bookings';
import { bookingsInBlockedTime, listBlockedTime } from '@/server/admin/blocked-time';
import { loadClinicSettings } from '@/server/settings';
import type { SearchParams } from '../../messages';
import { blockTimeAction, removeBlockAction } from './actions';

export default async function BlockedTimePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const db = getDatabase();
  const [settings, people, blocks, params] = await Promise.all([
    loadClinicSettings(db),
    listAdminPractitioners(db),
    listBlockedTime(db),
    searchParams,
  ]);
  const rows = await Promise.all(
    blocks.map(async (block) => ({
      ...block,
      bookings: await bookingsInBlockedTime(db, block.id),
    })),
  );
  const when = (instant: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(instant);
  return (
    <section>
      <h1>Blocked time</h1>
      <p>
        <Link href="/admin" prefetch={false} className="underline">
          Back to bookings
        </Link>
      </p>
      <p>Block time when a practitioner is away. Existing bookings stay confirmed.</p>
      <p>All times are in {settings.timeZone}. When clocks go back, a repeated time uses its first occurrence.</p>
      {params.saved === '1' ? (
        <p role="status" className="notice">
          Blocked time saved.
        </p>
      ) : null}
      {params.removed === '1' ? (
        <p role="status" className="notice">
          Blocked time removed.
        </p>
      ) : null}
      {params.error ? (
        <p role="alert" className="alert">
          Choose a practitioner and valid start and end times, with the end after the start. The reason must be no more
          than 500 characters. Times skipped when clocks change cannot be used.
        </p>
      ) : null}
      <form action={blockTimeAction} className="my-6 space-y-4">
        <label>
          Practitioner
          <select name="practitionerId" required data-testid="block-practitioner">
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input type="datetime-local" name="start" required data-testid="block-start" />
        </label>
        <label>
          End
          <input type="datetime-local" name="end" required data-testid="block-end" />
        </label>
        <label>
          Reason (optional)
          <input name="reason" maxLength={500} data-testid="block-reason" />
        </label>
        <button type="submit" className="button" data-testid="block-save">
          Block time
        </button>
      </form>
      <h2>Blocked periods</h2>
      {rows.length === 0 ? <p>No blocked time.</p> : null}
      {rows.map((block) => (
        <article key={block.id} className="my-4 border-t py-4" data-testid="blocked-period">
          <h3>{block.practitionerName}</h3>
          <p>
            {when(block.startsAt)} to {when(block.endsAt)}
          </p>
          {block.reason ? <p>{block.reason}</p> : null}
          {block.bookings.length ? (
            <div role="alert" className="alert" data-testid="block-warning">
              <p>
                Warning: {block.bookings.length} existing bookings overlap this blocked time. Contact these clients.
                Their bookings have not been cancelled.
              </p>
              <ul>
                {block.bookings.map((booking) => (
                  <li key={booking.id}>
                    {booking.patientName}, {when(booking.startsAt)}, {booking.email}
                    {booking.phone ? `, ${booking.phone}` : ''} (Confirmed)
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No existing bookings overlap this time.</p>
          )}
          <form action={removeBlockAction}>
            <input type="hidden" name="id" value={block.id} />
            <button type="submit" className="button-secondary">
              Remove blocked time
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
