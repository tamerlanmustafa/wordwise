/**
 * Sharing a word.
 *
 * The image path is best-effort by design — it depends on a native rasteriser
 * finishing, a disk write succeeding and the platform accepting a file URL —
 * so what actually needs pinning is the *fallback*. A share button that does
 * nothing because the capture failed is a worse outcome than one that shares
 * plain text, and every failure here has to land on text rather than on the
 * floor.
 */

import { Platform, Share } from 'react-native';

import { rasterise, shareWordCard } from '../shareWordCard';

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri = 'file:///cache/wordwise-run.png';
    exists = false;
    create() {}
    write() {}
    delete() {}
  },
}));

const shareSpy = jest.spyOn(Share, 'share');

/** A rasteriser that answers with `base64`, or never answers when null. */
const node = (base64: string | null) => ({
  toDataURL: (cb: (b: string) => void) => {
    if (base64 !== null) cb(base64);
  },
});

beforeEach(() => {
  shareSpy.mockReset();
  shareSpy.mockResolvedValue({ action: 'sharedAction' } as never);
  Platform.OS = 'ios';
});

describe('rasterise', () => {
  it('resolves with the base64 the native side hands back', async () => {
    await expect(rasterise(node('AAAA'))).resolves.toBe('AAAA');
  });

  it('resolves null rather than hanging when the callback never fires', async () => {
    // The native rasteriser has no failure path: an un-laid-out or torn-down
    // surface simply never calls back, and a bare await would leave the share
    // button spinning forever.
    jest.useFakeTimers();
    const pending = rasterise(node(null));
    jest.advanceTimersByTime(5000);
    await expect(pending).resolves.toBeNull();
    jest.useRealTimers();
  });

  it('resolves null when the rasteriser throws', async () => {
    await expect(
      rasterise({
        toDataURL: () => {
          throw new Error('surface gone');
        },
      }),
    ).resolves.toBeNull();
  });

  it('ignores a second callback rather than resolving twice', async () => {
    let calls = 0;
    const twice = {
      toDataURL: (cb: (b: string) => void) => {
        calls += 1;
        cb('A');
        cb('B');
      },
    };
    await expect(rasterise(twice)).resolves.toBe('A');
    expect(calls).toBe(1);
  });
});

describe('shareWordCard', () => {
  it('shares the image on iOS when the capture succeeds', async () => {
    const outcome = await shareWordCard({ word: 'run', sentence: 'Run home.', node: node('AAAA') });
    expect(outcome).toBe('image');
    expect(shareSpy.mock.calls[0][0]).toMatchObject({ url: 'file:///cache/wordwise-run.png' });
  });

  it('carries the text alongside the image, so the link is not lost', async () => {
    // iOS offers both to targets that take both (Messages, Mail); choosing the
    // richer format must not drop the URL.
    await shareWordCard({ word: 'run', sentence: 'Run home.', node: node('AAAA') });
    expect(shareSpy.mock.calls[0][0]).toMatchObject({
      message: expect.stringContaining('getwordwise.us'),
    });
  });

  it('falls back to text when the capture fails', async () => {
    jest.useFakeTimers();
    const pending = shareWordCard({ word: 'run', sentence: 'Run home.', node: node(null) });
    jest.advanceTimersByTime(5000);
    const outcome = await pending;
    jest.useRealTimers();

    expect(outcome).toBe('text');
    expect(shareSpy.mock.calls[0][0]).not.toHaveProperty('url');
  });

  it('falls back to text when there is no card mounted yet', async () => {
    // The ref is null for a frame after the current word changes; tapping in
    // that window must still share something.
    const outcome = await shareWordCard({ word: 'run', sentence: 'Run home.', node: null });
    expect(outcome).toBe('text');
  });

  it('shares text on Android, where a file URL is ignored', async () => {
    // React Native's Share reads only `title` and `message` on Android, so a
    // file URL there would be dropped or posted as literal text. Image sharing
    // needs `expo-sharing`, a native module and therefore a store build.
    Platform.OS = 'android';
    const outcome = await shareWordCard({ word: 'run', sentence: 'Run home.', node: node('AAAA') });
    expect(outcome).toBe('text');
    expect(shareSpy.mock.calls[0][0]).not.toHaveProperty('url');
  });

  it('reports failure only when the share sheet itself refuses', async () => {
    shareSpy.mockRejectedValue(new Error('no sheet'));
    const outcome = await shareWordCard({ word: 'run', sentence: null, node: null });
    expect(outcome).toBe('failed');
  });

  it('omits the quote block for a word with no sentence', async () => {
    await shareWordCard({ word: 'run', sentence: null, node: null });
    expect(shareSpy.mock.calls[0][0]).toMatchObject({
      message: 'run\n\nhttps://getwordwise.us',
    });
  });
});
