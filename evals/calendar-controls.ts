import { expect, type Locator } from '@playwright/test';

function contrast(first: string, second: string): number {
  const luminance = (colour: string) => {
    const channels = colour.match(/\d+/g)!.map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// DS-2 and DS-5: check the rendered control, including hover and keyboard focus.
export async function checkCalendarSecondary(control: Locator, surroundingColour: string): Promise<void> {
  const pine = 'rgb(29, 92, 75)';
  await control.page().mouse.move(0, 0);
  for (const hovered of [false, true]) {
    if (hovered) await control.hover();
    await expect(control).toHaveCSS('color', pine);
    await expect(control).toHaveCSS('border-top-color', pine);
    await expect(control).toHaveCSS('border-top-style', 'solid');
    await expect(control).toHaveCSS('border-top-width', '1px');
    await expect(control).toHaveCSS('background-color', hovered ? 'rgb(241, 238, 232)' : 'rgb(255, 255, 255)');
    const colours = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, border: style.borderTopColor, fill: style.backgroundColor };
    });
    expect(contrast(colours.text, colours.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.border, colours.fill)).toBeGreaterThanOrEqual(3);
    expect(contrast(colours.border, surroundingColour)).toBeGreaterThanOrEqual(3);
  }
  // Tab back to the control so :focus-visible is checked using keyboard input.
  await control.focus();
  await control.press('Tab');
  await control.page().keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-color', pine);
  await expect(control).toHaveCSS('outline-style', 'solid');
  await expect(control).toHaveCSS('outline-width', '2px');
  expect(contrast(pine, surroundingColour)).toBeGreaterThanOrEqual(3);
  const size = await control.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(size!.width).toBeGreaterThanOrEqual(44);
  // Leave hover before checking another control.
  await control.page().mouse.move(0, 0);
}
