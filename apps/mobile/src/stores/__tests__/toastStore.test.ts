import { useToastStore, showToast, DEFAULT_TOAST_DURATION } from '../toastStore';

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
