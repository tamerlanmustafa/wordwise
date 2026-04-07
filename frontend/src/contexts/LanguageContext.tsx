import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface LanguageContextType {
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  availableLanguages: LanguageOption[];
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

const AVAILABLE_LANGUAGES: LanguageOption[] = [
  { code: 'ES', name: 'Spanish', nativeName: 'Español' },
  { code: 'FR', name: 'French', nativeName: 'Français' },
  { code: 'DE', name: 'German', nativeName: 'Deutsch' },
  { code: 'IT', name: 'Italian', nativeName: 'Italiano' },
  { code: 'PT', name: 'Portuguese', nativeName: 'Português' },
  { code: 'RU', name: 'Russian', nativeName: 'Русский' },
  { code: 'TR', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'JA', name: 'Japanese', nativeName: '日本語' },
  { code: 'ZH', name: 'Chinese', nativeName: '中文' },
  { code: 'NL', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'PL', name: 'Polish', nativeName: 'Polski' },
  { code: 'AZ', name: 'Azerbaijani (Beta)', nativeName: 'Azərbaycan' },
];

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

interface LanguageProviderProps {
  children: ReactNode;
}

// Helper to get initial language from user settings or localStorage fallback
function getInitialLanguage(): string {
  // User's learning_language is the translation target — check it first
  const userStr = localStorage.getItem('wordwise_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      const lang = user.learning_language || user.native_language;
      if (lang) {
        const upperCode = lang.toUpperCase();
        if (AVAILABLE_LANGUAGES.some(l => l.code === upperCode)) {
          return upperCode;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Fall back to explicit localStorage selection (legacy / manual override)
  const saved = localStorage.getItem('wordwise_target_language');
  if (saved && AVAILABLE_LANGUAGES.some(l => l.code === saved)) return saved;

  return 'ES';
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [targetLanguage, setTargetLanguageState] = useState<string>(getInitialLanguage);

  // Persist to localStorage when changed
  const setTargetLanguage = (lang: string) => {
    setTargetLanguageState(lang);
    localStorage.setItem('wordwise_target_language', lang);
  };

  // Re-sync when user data changes in localStorage (e.g., after login or settings save)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'wordwise_user') {
        const newLang = getInitialLanguage();
        if (newLang !== targetLanguage) {
          setTargetLanguageState(newLang);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [targetLanguage]);

  return (
    <LanguageContext.Provider
      value={{
        targetLanguage,
        setTargetLanguage,
        availableLanguages: AVAILABLE_LANGUAGES
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
