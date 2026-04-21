// Shared constants used by both the web frontend and the mobile app.
// Keep this file pure data — no React, no platform-specific imports.

export interface LanguageOption {
  code: string;
  name: string;
  nativeName?: string;
}

export interface ProficiencyLevel {
  code: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  name: string;
}

// Lowercase ISO codes used by backend/auth (native_language, learning_language).
// Used in web SettingsPage/SignUpPage and in mobile SettingsScreen.
export const SUPPORTED_LANGUAGES: ReadonlyArray<LanguageOption> = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'cs', name: 'Czech' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'bg', name: 'Bulgarian' },
];

// Uppercase codes used by translation/dictionary APIs as the target language.
// Used by web LanguageContext and mobile's HomeScreen language picker.
export const AVAILABLE_LANGUAGES: ReadonlyArray<LanguageOption> = [
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

export const PROFICIENCY_LEVELS: ReadonlyArray<ProficiencyLevel> = [
  { code: 'A1', name: 'A1 - Beginner' },
  { code: 'A2', name: 'A2 - Elementary' },
  { code: 'B1', name: 'B1 - Intermediate' },
  { code: 'B2', name: 'B2 - Upper Intermediate' },
  { code: 'C1', name: 'C1 - Advanced' },
  { code: 'C2', name: 'C2 - Proficient' },
];
