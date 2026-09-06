/**
 * useFeedLevel — the CEFR level the Home feed is showing, owned by the user's
 * profile but temporarily overridable from the level chip.
 *
 * Home used to do this with a bare `useState(user?.proficiency_level || 'B1')`,
 * which reads the profile exactly once, at mount. Two ways that goes wrong:
 *
 *   1. Home is inside KeepAlive, so it mounts once and stays mounted for the
 *      whole session. Change your level in Settings and the feed kept querying
 *      the old one — silently, with the chip agreeing with itself.
 *   2. On a cold start Home can mount before `user` has loaded, in which case
 *      it froze the 'B1' fallback and never picked up the real level at all.
 *
 * So the profile is treated as the owner and this as a cache of it: a *change*
 * in `profileLevel` is adopted, while an unchanged one leaves a hand-picked
 * level alone. Manual picks are session-scoped on purpose — they're an
 * excursion ("what do C1 films look like?"), not a new preference, and the
 * feed returns to who you are next time.
 */

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LEVEL } from '../components/filmFeed/filterOptions';

export function useFeedLevel(profileLevel?: string | null) {
  const [level, setLevel] = useState(profileLevel || DEFAULT_LEVEL);
  // What the profile said last time we looked. Comparing against this (rather
  // than against `level`) is what lets a manual pick survive re-renders while
  // still yielding to a genuine profile change.
  const lastProfile = useRef(profileLevel);

  useEffect(() => {
    if (!profileLevel || profileLevel === lastProfile.current) return;
    lastProfile.current = profileLevel;
    setLevel(profileLevel);
  }, [profileLevel]);

  return [level, setLevel] as const;
}
