/**
 * The device zone is what lets the server measure a day the user recognises.
 *
 * Until this existed the server had no client timezone and said so in a
 * comment, so every streak decision was made in UTC — a day that rolls over at
 * 4pm in Los Angeles and at 1pm in Auckland. This module is the missing half.
 *
 * The guarded shape is the point. `expo-localization` is a native module, so
 * under Jest it is absent and this must return `null` rather than throw during
 * module init — the same bargain `i18n/getDeviceLanguage` already makes. `null`
 * is a real answer, not a failure: the server falls back to UTC, which is
 * exactly what every account did before the column existed.
 */

import { getDeviceTimezone } from '../deviceTimezone';

describe('getDeviceTimezone', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-localization');
  });

  it('returns a zone without throwing when the native module is absent', () => {
    // What actually runs under Jest. It must degrade, and it must not return
    // an empty string — `''` would be stored and then fall back to UTC
    // forever, which is the one outcome worse than null.
    const zone = getDeviceTimezone();
    expect(zone === null || (typeof zone === 'string' && zone.length > 0)).toBe(true);
  });

  it('prefers the native module when it is there', () => {
    jest.resetModules();
    jest.doMock('expo-localization', () => ({
      getCalendars: () => [{ timeZone: 'Europe/Istanbul' }],
    }));
    const { getDeviceTimezone: fresh } = require('../deviceTimezone');
    expect(fresh()).toBe('Europe/Istanbul');
  });

  it('falls through to Intl when the native module gives nothing', () => {
    // A platform where `getCalendars` exists but reports no zone. Intl is the
    // second source rather than the first because RN's Hermes build has
    // shipped without full ICU before.
    jest.resetModules();
    jest.doMock('expo-localization', () => ({ getCalendars: () => [{}] }));
    const { getDeviceTimezone: fresh } = require('../deviceTimezone');
    const zone = fresh();
    expect(zone === null || typeof zone === 'string').toBe(true);
  });

  it('returns null rather than throwing when the module explodes', () => {
    jest.resetModules();
    jest.doMock('expo-localization', () => {
      throw new Error('native module missing');
    });
    const { getDeviceTimezone: fresh } = require('../deviceTimezone');
    // Intl may still answer in the Jest environment; the contract is only that
    // it does not throw, and never yields an empty string.
    const zone = fresh();
    expect(zone === null || (typeof zone === 'string' && zone.length > 0)).toBe(true);
  });

  it('never returns an IANA-less offset string', () => {
    // The column stores a zone NAME on purpose: an offset is wrong twice a
    // year wherever daylight saving applies, and a streak that breaks on the
    // clock change is the bug this replaces.
    jest.resetModules();
    jest.doMock('expo-localization', () => ({
      getCalendars: () => [{ timeZone: 'America/Los_Angeles' }],
    }));
    const { getDeviceTimezone: fresh } = require('../deviceTimezone');
    expect(fresh()).toMatch(/\//);
    expect(fresh()).not.toMatch(/^[+-]?\d/);
  });
});
