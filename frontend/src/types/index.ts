export interface User {
  id: number;
  email: string;
  username: string;
  language_preference: string;
  proficiency_level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  is_active: boolean;
  created_at: string;
}

export interface Movie {
  id: number;
  title: string;
  year: number;
  genre?: string;
  difficulty_level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  word_count: number;
  description?: string;
  poster_url?: string;
  created_at: string;
}

export interface Word {
  id: number;
  word: string;
  definition?: string;
  difficulty_level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  frequency: number;
  part_of_speech?: string;
  example_sentence?: string;
  translation?: string;
}

export interface UserWordList {
  id: number;
  user_id: number;
  word_id: number;
  list_type: 'learn_later' | 'favorites' | 'mastered';
  added_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  username: string;
  password: string;
  language_preference?: string;
  proficiency_level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
}


