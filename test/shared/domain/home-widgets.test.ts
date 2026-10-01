import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_SETTINGS,
  isHomeSettingsShape,
  isHomeWidgetConfigValid,
  normalizeHomeSettings,
  MAX_HOME_NOTE_LENGTH,
  MAX_GREETING_LENGTH,
} from '../../../src/shared/domain/home';
import { greetingByHour } from '../../../src/renderer/src/utils/greeting';
describe('home widget additions and migration', () => {
  it('migrates old layouts without enabling new widgets', () => {
    const old = {
      widgets: DEFAULT_HOME_SETTINGS.widgets.filter(
        (widget) => !['notes', 'links'].includes(widget.id),
      ),
    };
    const home = normalizeHomeSettings(old);
    expect(home.widgets.slice(-2).map((widget) => [widget.id, widget.enabled])).toEqual([
      ['notes', false],
      ['links', false],
    ]);
    expect(isHomeSettingsShape(home)).toBe(true);
  });
  it('accepts old clock configuration and fills a missing custom greeting', () => {
    const config = { hour24: true, showDate: true, showGreeting: true };
    expect(isHomeWidgetConfigValid('clock', config)).toBe(true);
    expect(
      normalizeHomeSettings({ widgets: [{ id: 'clock', enabled: true, config }] }).widgets[0]!
        .config,
    ).toMatchObject({ customGreeting: '' });
  });
  it('bounds note and greeting lengths', () => {
    const home = normalizeHomeSettings({
      widgets: [
        { id: 'notes', enabled: true, config: { text: 'n'.repeat(MAX_HOME_NOTE_LENGTH + 1) } },
        {
          id: 'clock',
          enabled: true,
          config: { customGreeting: 'g'.repeat(MAX_GREETING_LENGTH + 1) },
        },
      ],
    });
    expect(home.widgets[0]!.config).toEqual({ text: 'n'.repeat(MAX_HOME_NOTE_LENGTH) });
    expect(home.widgets[1]!.config).toMatchObject({
      customGreeting: 'g'.repeat(MAX_GREETING_LENGTH),
    });
    expect(isHomeWidgetConfigValid('notes', { text: 'n'.repeat(MAX_HOME_NOTE_LENGTH + 1) })).toBe(
      false,
    );
  });
  it('rejects unsafe links and deduplicates persisted links', () => {
    const good = { id: 'a', name: 'Docs', url: 'https://example.com/docs' };
    for (const url of [
      'javascript:alert(1)',
      'file:///tmp/a',
      'https://user:pass@example.com',
      'not a url',
    ]) {
      expect(isHomeWidgetConfigValid('links', { links: [{ ...good, url }] })).toBe(false);
    }
    // HTTP 与 HTTPS 均允许，不再限制协议明文。
    expect(
      isHomeWidgetConfigValid('links', { links: [{ ...good, url: 'http://example.com' }] }),
    ).toBe(true);
    expect(
      isHomeWidgetConfigValid('links', { links: [{ ...good, url: 'http://192.168.1.10:6099' }] }),
    ).toBe(true);
    const home = normalizeHomeSettings({
      widgets: [
        {
          id: 'links',
          enabled: true,
          config: { links: [good, good, { ...good, id: 'b', url: 'file:///x' }] },
        },
      ],
    });
    expect(home.widgets[0]!.config).toEqual({ links: [good] });
    expect(isHomeWidgetConfigValid('links', { links: [good, good] })).toBe(false);
  });
  it('uses custom greetings and restores time-based fallback when empty', () => {
    expect(greetingByHour(8, '  欢迎回来喵  ')).toBe('欢迎回来喵');
    expect(greetingByHour(8, ' ')).toBe(greetingByHour(8));
    expect(greetingByHour(23, '')).toContain('晚上');
  });
});
