/**
 * TopInsetView — a screen root that clears the status bar on its FIRST frame.
 *
 * A drop-in replacement for `<SafeAreaView edges={['top']}>` from
 * react-native-safe-area-context, and it exists because of a measured bug
 * rather than a preference.
 *
 * What was wrong
 * --------------
 * `SafeAreaView` is a *native* view: it applies its edge padding during native
 * layout, one or more frames after the JS render that created it. For a screen
 * that is already mounted that is invisible — the padding was applied long ago.
 * But the tab screens are mounted **lazily** by `KeepAlive`, so the first tap
 * on a tab after a cold start is the one and only time that screen is laid out
 * from scratch — and it paints once with **zero top padding**, i.e. tucked
 * under the status bar, before snapping down.
 *
 * Measured on an iPhone 17 Pro simulator, first tap on Explore after a cold
 * start (top inset 62pt):
 *
 *     +158ms   search bar drawn OVER the clock and battery
 *     +291ms   still over them
 *     +423ms   snapped down to the right place
 *
 * So roughly a quarter of a second of visibly broken layout, once per launch
 * per tab. With this component the very first painted frame (+148ms) is
 * already correct.
 *
 * Why this fixes it
 * -----------------
 * `useSafeAreaInsets()` is a JS hook reading context that the provider has
 * already measured — verified by logging it, it reads the correct 62 on the
 * very first render, which is what ruled out "the provider hasn't measured
 * yet" as the cause. Applying it as an ordinary style means the padding is
 * part of the same commit as the content, so there is no frame in between for
 * the user to see.
 *
 * Only the top edge, because that is the only edge these screens asked for —
 * the bottom is owned by `useBottomBarInset()` and the floating tab bar.
 */

import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function TopInsetView({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  return <View style={[style, { paddingTop: insets.top }]}>{children}</View>;
}
