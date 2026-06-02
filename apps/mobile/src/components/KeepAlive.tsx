import { useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * KeepAlive — mount children lazily on first `visible`, then keep them
 * mounted across visibility toggles (hidden via `display:'none'`).
 *
 * Used to wrap the bottom-tab screens (Home / My Movies / Practice) so
 * switching tabs no longer unmounts the previous screen. That preserves
 * each tab's scroll position and list/data state, and avoids a refetch on
 * every switch. A hidden tab is removed from layout (`display:'none'`) but
 * its native views — including the scroll offset of any ScrollView /
 * FlashList inside — are retained.
 *
 * Lazy mount: a tab returns `null` until the first time it becomes visible,
 * so we don't mount (and fire the data fetches of) every tab on cold start.
 */
interface Props {
  visible: boolean;
  children: ReactNode;
}

export function KeepAlive({ visible, children }: Props) {
  const hasMounted = useRef(visible);
  if (visible) hasMounted.current = true;
  if (!hasMounted.current) return null;

  return (
    <View
      style={[styles.fill, !visible && styles.hidden]}
      pointerEvents={visible ? 'auto' : 'none'}
      // collapsable={false} keeps the native view in the tree while hidden
      // so the contained list's scroll offset survives the toggle.
      collapsable={false}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
});
