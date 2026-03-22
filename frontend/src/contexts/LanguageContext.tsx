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

// Helper to get initial language from user or localStorage
function getInitialLanguage(): string {
  // First check localStorage for explicit selection
  const saved = localStorage.getItem('wordwise_target_language');
  if (saved) return saved;

  // Then check user's native language preference
  const userStr = localStorage.getItem('wordwise_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.native_language) {
        // Convert lowercase (es) to uppercase (ES) to match our language codes
        const upperCode = user.native_language.toUpperCase();
        // Only use if it's a valid language in our list
        if (AVAILABLE_LANGUAGES.some(lang => lang.code === upperCode)) {
          return upperCode;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Default to Spanish
  return 'ES';
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [targetLanguage, setTargetLanguageState] = useState<string>(getInitialLanguage);

  // Persist to localStorage when changed
  const setTargetLanguage = (lang: string) => {
    setTargetLanguageState(lang);
    localStorage.setItem('wordwise_target_language', lang);
  };

  // Sync with user's native language when user data changes (e.g., after login)
  useEffect(() => {
    const handleStorageChange = () => {
      // Only update if there's no explicit selection saved
      if (!localStorage.getItem('wordwise_target_language')) {
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
