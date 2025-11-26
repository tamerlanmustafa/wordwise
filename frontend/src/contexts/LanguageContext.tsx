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

export function LanguageProvider({ children }: LanguageProviderProps) {
  // Try to get from localStorage, fallback to Spanish
  const [targetLanguage, setTargetLanguageState] = useState<string>(() => {
    const saved = localStorage.getItem('wordwise_target_language');
    return saved || 'ES';
  });

  // Persist to localStorage when changed
  const setTargetLanguage = (lang: string) => {
    setTargetLanguageState(lang);
    localStorage.setItem('wordwise_target_language', lang);
  };

  // TODO: Sync with backend user preference when authentication is implemented
  useEffect(() => {
    // Future: Fetch user's language preference from backend
    // const fetchUserPreference = async () => {
    //   const user = await getCurrentUser();
    //   if (user?.languagePreference) {
    //     setTargetLanguage(user.languagePreference);
    //   }
    // };
    // fetchUserPreference();
  }, []);

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
