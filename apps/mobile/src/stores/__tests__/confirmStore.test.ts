import { useConfirmStore, showConfirm } from '../confirmStore';

describe('confirmStore', () => {
  beforeEach(() => {
    useConfirmStore.setState({ current: null });
  });

  it('show() opens a dialog with the given input', () => {
    const onConfirm = jest.fn();
    showConfirm({ title: 'Log out?', message: 'Bye', confirmLabel: 'Log out', tone: 'destructive', onConfirm });

    const current = useConfirmStore.getState().current;
    expect(current).toMatchObject({
      title: 'Log out?',
      message: 'Bye',
      confirmLabel: 'Log out',
      tone: 'destructive',
    });
    expect(current!.id).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('handleConfirm() runs onConfirm and closes', () => {
    const onConfirm = jest.fn();
    showConfirm({ title: 'Delete?', onConfirm });

    useConfirmStore.getState().handleConfirm();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('handleCancel() runs onCancel (if given) and closes', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    showConfirm({ title: 'Delete?', onConfirm, onCancel });

    useConfirmStore.getState().handleCancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('handleCancel() is safe without an onCancel handler', () => {
    showConfirm({ title: 'Delete?', onConfirm: jest.fn() });
    expect(() => useConfirmStore.getState().handleCancel()).not.toThrow();
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('a second show() replaces the current dialog (last wins)', () => {
    const first = jest.fn();
    const second = jest.fn();
    showConfirm({ title: 'First', onConfirm: first });
    showConfirm({ title: 'Second', onConfirm: second });

    expect(useConfirmStore.getState().current!.title).toBe('Second');
    useConfirmStore.getState().handleConfirm();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('confirm/cancel on an already-closed dialog are no-ops', () => {
    expect(() => {
      useConfirmStore.getState().handleConfirm();
      useConfirmStore.getState().handleCancel();
    }).not.toThrow();
  });
});
