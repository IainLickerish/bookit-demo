'use client';

import { useRef, useState } from 'react';
import { CALENDAR_MESSAGES } from '@/app/messages';
import { copyText } from '@/lib/clipboard';

export function CopyCalendarDetails({ details }: { details: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);

  async function copy() {
    if (field.current) setResult((await copyText(field.current)) ? 'copied' : 'failed');
  }

  return (
    <div className="space-y-4">
      <label htmlFor="calendar-details">Calendar details</label>
      <textarea
        id="calendar-details"
        ref={field}
        value={details}
        readOnly
        rows={9}
        className="w-full"
        aria-describedby="calendar-manual-help"
        data-testid="calendar-details"
      />
      <p id="calendar-manual-help" data-testid="calendar-manual-help">
        You can select and copy these details yourself, or type them into your calendar.
      </p>
      <button type="button" className="button" data-testid="copy-calendar-details" onClick={() => void copy()}>
        Copy calendar details
      </button>
      <p role="status" aria-live="polite" data-testid="calendar-copy-result">
        {result ? CALENDAR_MESSAGES[result] : ''}
      </p>
    </div>
  );
}
