/** Copy from the visible field, keeping it selected when the browser refuses. */
export async function copyText(field: HTMLTextAreaElement): Promise<boolean> {
  const document = field.ownerDocument;
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(field.value);
      return true;
    } catch {
      // Older browsers and local HTTP demos can still copy the selected text.
    }
  }

  const previousFocus = document.activeElement as HTMLElement | null;
  field.focus();
  field.select();
  try {
    if (document.execCommand('copy')) {
      previousFocus?.focus();
      return true;
    }
  } catch {
    // Leave the details focused and selected for manual copying.
  }
  return false;
}
