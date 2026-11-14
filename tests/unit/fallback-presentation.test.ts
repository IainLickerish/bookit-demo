import { Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';

describe('the shared error screen', () => {
  it('keeps private diagnostics out of its announced recovery message', () => {
    const error = Object.assign(new Error('Fictional private diagnostic'), { digest: 'fictional-error-reference' });
    const html = renderToStaticMarkup(ErrorPage({ error, reset: vi.fn() }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Please try again. If it keeps happening, contact the clinic.');
    expect(html).toContain('Try again');
    expect(html).not.toContain(error.message);
    expect(html).not.toContain(error.digest);
  });

  it('lets the existing Try again action reset the error boundary', () => {
    const reset = vi.fn();
    const element = ErrorPage({ error: new Error('Fictional failure'), reset });
    const retry = Children.toArray(element.props.children).find(
      (child) => isValidElement<{ onClick: () => void }>(child) && child.type === 'button',
    );
    expect(isValidElement(retry)).toBe(true);
    if (!isValidElement<{ onClick: () => void }>(retry)) throw new Error('No recovery action');
    retry.props.onClick();
    expect(reset).toHaveBeenCalledOnce();
  });
});
