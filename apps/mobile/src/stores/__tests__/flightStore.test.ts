import { useFlightStore, type Rect } from '../flightStore';

// flightStore drives the "poster flies to the reel tab" animation. It holds a
// single pending FlightSpec + the live reel-tab rect reported by the bottom bar.
const rect = (x: number): Rect => ({ x, y: 0, width: 100, height: 150 });

describe('flightStore', () => {
  beforeEach(() => {
    useFlightStore.setState({ pending: null, reelTabRect: null });
  });

  it('starts with nothing pending and no known reel-tab rect', () => {
    const s = useFlightStore.getState();
    expect(s.pending).toBeNull();
    expect(s.reelTabRect).toBeNull();
  });

  it('setReelTabRect stores the destination rect', () => {
    useFlightStore.getState().setReelTabRect(rect(42));
    expect(useFlightStore.getState().reelTabRect).toEqual(rect(42));
  });

  it('setReelTabRect(null) clears the destination', () => {
    useFlightStore.getState().setReelTabRect(rect(1));
    useFlightStore.getState().setReelTabRect(null);
    expect(useFlightStore.getState().reelTabRect).toBeNull();
  });

  it('fly() queues a pending spec carrying the poster + source rect', () => {
    useFlightStore.getState().fly({ posterPath: '/p.jpg', from: rect(10) });
    const pending = useFlightStore.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending!.posterPath).toBe('/p.jpg');
    expect(pending!.from).toEqual(rect(10));
  });

  it('assigns a fresh monotonically-increasing id so repeat flights retrigger', () => {
    const { fly } = useFlightStore.getState();
    fly({ posterPath: '/a.jpg', from: rect(0) });
    const first = useFlightStore.getState().pending!.id;
    fly({ posterPath: '/a.jpg', from: rect(0) }); // same poster, must differ
    const second = useFlightStore.getState().pending!.id;
    expect(second).toBeGreaterThan(first);
  });

  it('consume() clears the pending spec after the overlay animates', () => {
    useFlightStore.getState().fly({ posterPath: '/p.jpg', from: rect(10) });
    useFlightStore.getState().consume();
    expect(useFlightStore.getState().pending).toBeNull();
  });

  it('tolerates a null poster path (movie without artwork)', () => {
    useFlightStore.getState().fly({ posterPath: null, from: rect(5) });
    expect(useFlightStore.getState().pending!.posterPath).toBeNull();
  });
});
