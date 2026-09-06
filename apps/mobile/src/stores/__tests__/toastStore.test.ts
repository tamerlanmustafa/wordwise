import {
  useToastStore,
  showToast,
  visibleToasts,
  DEFAULT_TOAST_DURATION,
  VISIBLE_TOAST_LIMIT,
} from '../toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ queue: [] });
  });

  it('enqueues a toast with defaults', () => {
    const id = showToast({ message: 'Added to reel' });
    const q = useToastStore.getState().queue;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ id, message: 'Added to reel', tone: 'default', duration: DEFAULT_TOAST_DURATION });
  });

  it('honors tone + duration overrides', () => {
    showToast({ message: 'Offline', tone: 'error', duration: 1000 });
    expect(useToastStore.getState().queue[0]).toMatchObject({ tone: 'error', duration: 1000 });
  });

  it('queues multiple toasts in order with unique ids', () => {
    const a = showToast({ message: 'a' });
    const b = showToast({ message: 'b' });
    expect(a).not.toBe(b);
    expect(useToastStore.getState().queue.map((t) => t.message)).toEqual(['a', 'b']);
  });

  it('dismiss removes only the targeted toast', () => {
    const a = showToast({ message: 'a' });
    showToast({ message: 'b' });
    useToastStore.getState().dismiss(a);
    expect(useToastStore.getState().queue.map((t) => t.message)).toEqual(['b']);
  });

  it('clear empties the queue', () => {
    showToast({ message: 'a' });
    showToast({ message: 'b' });
    useToastStore.getState().clear();
    expect(useToastStore.getState().queue).toHaveLength(0);
  });
});

describe('visibleToasts', () => {
  beforeEach(() => {
    useToastStore.setState({ queue: [] });
  });

  const queue = () => useToastStore.getState().queue;

  it('shows a burst together rather than one at a time', () => {
    // The regression this guards: "seen it", "not interested" and + on a card
    // are tapped in sequence, and the host used to render only queue[0]. The
    // second confirmation appeared 3.6s after the tap that caused it, and its
    // Undo could not be reached until then.
    showToast({ message: 'a' });
    showToast({ message: 'b' });
    expect(visibleToasts(queue()).map((t) => t.message)).toEqual(['a', 'b']);
  });

  it('caps the stack and queues the overflow', () => {
    for (let i = 0; i < VISIBLE_TOAST_LIMIT + 2; i += 1) showToast({ message: `t${i}` });
    expect(visibleToasts(queue())).toHaveLength(VISIBLE_TOAST_LIMIT);
    // Nothing is dropped — the extras are still there, waiting for a slot.
    expect(queue()).toHaveLength(VISIBLE_TOAST_LIMIT + 2);
  });

  it('promotes the next queued toast when one is dismissed', () => {
    for (let i = 0; i < VISIBLE_TOAST_LIMIT + 1; i += 1) showToast({ message: `t${i}` });
    const overflow = `t${VISIBLE_TOAST_LIMIT}`;
    expect(visibleToasts(queue()).map((t) => t.message)).not.toContain(overflow);

    useToastStore.getState().dismiss(queue()[0].id);
    expect(visibleToasts(queue()).map((t) => t.message)).toContain(overflow);
  });

  it('keeps oldest-first order so an arrival never displaces a toast in reach', () => {
    // Newest-on-top would push every visible toast down a row the moment
    // another lands — including the one whose Undo a thumb is already moving
    // toward.
    showToast({ message: 'first' });
    showToast({ message: 'second' });
    const before = visibleToasts(queue())[0];
    showToast({ message: 'third' });
    expect(visibleToasts(queue())[0]).toBe(before);
  });
});
