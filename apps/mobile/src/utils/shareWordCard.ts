/**
 * shareWordCard — turn a rendered `ShareCard` into a PNG and hand it to the
 * OS share sheet.
 *
 * ## Why this is iOS-only, and why the split is here
 *
 * Rendering works on both platforms: `react-native-svg` rasterises natively.
 * *Sharing a file* does not. React Native's own `Share.share({ url })` passes
 * a file to the iOS activity sheet, which is exactly what Instagram Stories,
 * WhatsApp and Messages want — but on Android `Share` only reads `title` and
 * `message`, so a file URL there is either ignored or posted as literal text.
 *
 * The cross-platform answer is `expo-sharing`, which is a native module, and
 * adding one to this bare workflow means a store build and a runtimeVersion
 * bump rather than an OTA. That was a deliberate call: iOS ships the image
 * now, Android keeps the text share, and the card, the capture and the file
 * write below are all platform-agnostic so switching Android on later is one
 * dependency and one branch — not a rewrite.
 *
 * The branch lives in this module rather than at the call site so the screen
 * asks for "share this word" and never has to know which platform it is on.
 */

import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { shareFileName } from '../components/wordFeed/shareCardLayout';

/** Anything with react-native-svg's rasteriser on it. */
export interface Rasterisable {
  toDataURL: (callback: (base64: string) => void, options?: object) => void;
}

export type ShareOutcome = 'image' | 'text' | 'failed';

/** The rasteriser takes a callback and has no timeout of its own. */
const RASTERISE_TIMEOUT_MS = 4000;

/**
 * `toDataURL` as a promise.
 *
 * Bounded, because it is a native callback with no failure path: if the view
 * is not laid out yet, or the surface was torn down between mount and capture,
 * the callback is simply never invoked and a bare `await` would hang the share
 * button forever with no way back.
 */
export function rasterise(node: Rasterisable): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => done(null), RASTERISE_TIMEOUT_MS);
    try {
      node.toDataURL((base64) => {
        clearTimeout(timer);
        done(base64 ?? null);
      });
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/**
 * Writes the PNG into the cache directory and returns its URI.
 *
 * Cache, not documents: this is a throwaway the OS may reclaim, and it would
 * otherwise accumulate one file per share forever in a directory that is
 * backed up. Overwriting by name means repeated shares of the same word reuse
 * one file rather than growing the directory.
 */
export function writePng(base64: string, word: string): string {
  const file = new File(Paths.cache, shareFileName(word));
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  return file.uri;
}

export interface ShareWordInput {
  word: string;
  sentence?: string | null;
  /** The already-mounted card, or null when it could not be rendered. */
  node: Rasterisable | null;
}

/**
 * Share a word, as an image where the platform allows it and as text where it
 * does not.
 *
 * Never throws: a share that fails is reported through the return value so the
 * caller can toast. The text fallback runs whenever the image path is
 * unavailable *for any reason* — wrong platform, rasteriser timed out, disk
 * write failed — because a share sheet with the word in it is a far better
 * outcome than a button that does nothing.
 */
export async function shareWordCard({
  word,
  sentence,
  node,
}: ShareWordInput): Promise<ShareOutcome> {
  const message = sentence
    ? `${word}\n\n"${sentence}"\n\nhttps://getwordwise.us`
    : `${word}\n\nhttps://getwordwise.us`;

  if (Platform.OS === 'ios' && node) {
    try {
      const base64 = await rasterise(node);
      if (base64) {
        const uri = writePng(base64, word);
        // `message` rides along: iOS puts the image in the sheet and offers
        // the text to targets that take both (Messages, Mail), so the link is
        // not lost by choosing the richer format.
        await Share.share({ url: uri, message });
        return 'image';
      }
    } catch {
      // Fall through to text. A failed capture must not cost the user a share.
    }
  }

  try {
    await Share.share({ message });
    return 'text';
  } catch {
    return 'failed';
  }
}
