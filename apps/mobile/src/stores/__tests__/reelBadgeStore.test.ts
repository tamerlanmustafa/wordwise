import { useReelBadgeStore } from '../reelBadgeStore';

// The reel-tab "newly added" badge. Ephemeral (no persistence) — bumped by
// AddToReelChip, cleared when the user opens the journey/reel screen.
describe('reelBadgeStore', () => {
  beforeEach(() => {
    useReelBadgeStore.setState({ count: 0 });
  });

  it('starts at zero', () => {
    expect(useReelBadgeStore.getState().count).toBe(0);
  });

  it('bump() increments by one each call', () => {
    const { bump } = useReelBadgeStore.getState();
    bump();
    bump();
    bump();
    expect(useReelBadgeStore.getState().count).toBe(3);
  });

  it('unbump() decrements but never goes below zero', () => {
    const { bump, unbump } = useReelBadgeStore.getState();
    bump();
    unbump();
    unbump(); // would be -1 without the floor
    expect(useReelBadgeStore.getState().count).toBe(0);
  });

  it('clear() resets to zero from any count', () => {
    const { bump, clear } = useReelBadgeStore.getState();
    bump();
    bump();
    clear();
    expect(useReelBadgeStore.getState().count).toBe(0);
  });

  it('a bump/unbump cycle settles back where it started', () => {
    const { bump, unbump } = useReelBadgeStore.getState();
    bump();
    bump();
    bump();
    unbump();
    expect(useReelBadgeStore.getState().count).toBe(2);
  });
});
