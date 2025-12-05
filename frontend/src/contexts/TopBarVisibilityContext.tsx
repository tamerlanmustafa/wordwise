import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface TopBarVisibilityContextType {
  showTopBar: boolean;
  setShowTopBar: (show: boolean) => void;
}

const TopBarVisibilityContext = createContext<TopBarVisibilityContextType | undefined>(undefined);

export function TopBarVisibilityProvider({ children }: { children: ReactNode }) {
  const [showTopBar, setShowTopBar] = useState(true);

  return (
    <TopBarVisibilityContext.Provider value={{ showTopBar, setShowTopBar }}>
      {children}
    </TopBarVisibilityContext.Provider>
  );
}

export function useTopBarVisibility() {
  const context = useContext(TopBarVisibilityContext);
  if (context === undefined) {
    throw new Error('useTopBarVisibility must be used within a TopBarVisibilityProvider');
  }
  return context;
}
