import { describe, expect, it } from 'vitest';
import type { PaletteStyle } from '../../../../src/shared/domain/settings';
import { buildThemeScheme, shouldReduceMotion } from '../../../../src/renderer/src/services/theme';

const paletteStyles: PaletteStyle[] = [
  'tonal-spot',
  'neutral',
  'vibrant',
  'expressive',
  'rainbow',
  'fruit-salad',
  'monochrome',
  'fidelity',
  'content',
];

describe('dynamic Material theme', () => {
  it.each(paletteStyles)('builds a complete %s palette', (style) => {
    const scheme = buildThemeScheme('#367BF0', false, style, 'standard');

    expect(scheme.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(scheme.secondaryContainer).toMatch(/^#[0-9a-f]{6}$/i);
    expect(scheme.tertiaryContainer).toMatch(/^#[0-9a-f]{6}$/i);
    expect(scheme.onSurface).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('changes generated roles when contrast is increased', () => {
    const standard = buildThemeScheme('#367BF0', true, 'expressive', 'standard');
    const high = buildThemeScheme('#367BF0', true, 'expressive', 'high');

    expect(high.primary).not.toBe(standard.primary);
    expect(high.onSurface).not.toBe(standard.onSurface);
  });

  it('resolves explicit and system motion preferences', () => {
    expect(shouldReduceMotion('system', true)).toBe(true);
    expect(shouldReduceMotion('system', false)).toBe(false);
    expect(shouldReduceMotion('expressive', true)).toBe(false);
    expect(shouldReduceMotion('reduced', false)).toBe(true);
    expect(shouldReduceMotion('none', false)).toBe(true);
  });
});
