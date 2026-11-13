import { describe, expect, it, vi } from 'vitest';
import { copyText } from '@/lib/clipboard';

function fieldWith(clipboard: { writeText(text: string): Promise<void> } | undefined) {
  const previousFocus = { focus: vi.fn() };
  const document = {
    defaultView: { navigator: { clipboard } },
    activeElement: previousFocus,
    execCommand: vi.fn(() => true),
  };
  const field = {
    value: 'Clinic: Acme Physio\nStart: Tue, 8 Dec 2026, 11:15\nDuration: 45 minutes',
    ownerDocument: document,
    focus: vi.fn(),
    select: vi.fn(),
  };
  return { field, document, previousFocus, element: field as unknown as HTMLTextAreaElement };
}

describe('copying calendar text', () => {
  it('copies the complete visible text using the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { field, element, document } = fieldWith({ writeText });
    expect(await copyText(element)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(field.value);
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(field.focus).not.toHaveBeenCalled();
  });

  it.each(['missing', 'refused'] as const)('copies selected text when the newer API is %s', async (reason) => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard refused'));
    const { field, element, document, previousFocus } = fieldWith(reason === 'missing' ? undefined : { writeText });
    expect(await copyText(element)).toBe(true);
    expect(field.focus).toHaveBeenCalledOnce();
    expect(field.select).toHaveBeenCalledOnce();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(previousFocus.focus).toHaveBeenCalledOnce();
    expect(field.value).toContain('Duration: 45 minutes');
  });

  it.each(['missing', 'refused'] as const)(
    'keeps details selected for manual copying when both paths fail and the newer API is %s',
    async (reason) => {
      const writeText = vi.fn().mockRejectedValue(new Error('Clipboard refused'));
      const { field, element, document, previousFocus } = fieldWith(reason === 'missing' ? undefined : { writeText });
      document.execCommand.mockReturnValue(false);
      expect(await copyText(element)).toBe(false);
      expect(field.focus).toHaveBeenCalledOnce();
      expect(field.select).toHaveBeenCalledOnce();
      expect(previousFocus.focus).not.toHaveBeenCalled();
    },
  );

  it('keeps details selected when selected-text copying throws', async () => {
    const { field, element, document, previousFocus } = fieldWith(undefined);
    document.execCommand.mockImplementation(() => {
      throw new Error('Copy command refused');
    });
    expect(await copyText(element)).toBe(false);
    expect(field.focus).toHaveBeenCalledOnce();
    expect(field.select).toHaveBeenCalledOnce();
    expect(previousFocus.focus).not.toHaveBeenCalled();
  });
});
