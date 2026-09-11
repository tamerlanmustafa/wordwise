/**
 * The device's IANA timezone, for the server's day arithmetic.
 *
 * Every date WordWise cares about — the streak, the free tier's one lesson a
 * day, the chest, the freeze gap — is decided on the server, and until now the
 * server decided them in UTC because it had no reliable client timezone. This
 * is that timezone. The server stores it on the user and derives "today" from
 * it (`backend/src/utils/dates.local_today`).
 *
 * An IANA name ("Europe/Istanbul"), never an offset. An offset is wrong twice a
 * year wherever daylight saving applies, and a streak that breaks on the clock
 * change is precisely the failure this exists to remove.
 *
 * `expo-localization` is a native module, so it is required lazily and guarded
 * exactly as `i18n/index.getDeviceLanguage` does — under Jest, and on any
 * platform where the module is missing, this must return `null` rather than
 * throw during module init. `null` is a real answer: the server falls back to
 * UTC, which is what every account did before this existed.
 *
 * `Intl` is the second source rather than the first because React Native's
 * Hermes build has shipped without full ICU in the past; `expo-localization`
 * reads the platform directly and is the one already in the binary.
 */
export function getDeviceTimezone(): string | null {
  try {
    const { getCalendars } = require('expo-localization');
    const zone = getCalendars?.()?.[0]?.timeZone;
    if (typeof zone === 'string' && zone.length > 0) return zone;
  } catch {
    // fall through to Intl
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === 'string' && zone.length > 0) return zone;
  } catch {
    // no zone available
  }
  return null;
}
