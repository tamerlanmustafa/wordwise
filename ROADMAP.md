
## Short-Term Priorities (10 Goals)

### 1. Rate Limiting & Security
- [ ] Add rate limiting to auth endpoints (prevent brute force)
- [ ] Add rate limiting to translation endpoints (protect API quotas)
- [ ] Validate translation input length (max 500 chars)
- [ ] Implement request timeouts for external APIs

### 2. Error Monitoring
- [ ] Set up error monitoring (Sentry or similar)
- [ ] Add graceful error states in UI for failed translations
- [ ] Improve error messages for common failures

### 3. Search & Filter in Vocabulary
- [ ] Real-time search within vocabulary lists
- [ ] Filter by: saved, learned
- [ ] Sort options: alphabetical, frequency, confidence

### 4. Translation Language Sync
- [ ] Sync LanguageContext with user's native_language from profile
- [ ] Auto-set translation target language based on user preferences

### 5. Redis Cache Layer
- [ ] Replace database-based TranslationCache with Redis
- [ ] Enable distributed caching for horizontal scaling
- [ ] Add TTL-based cache expiration (30 days for translations)

### 6. IndexedDB Persistence
- [ ] Cache translations in IndexedDB (survive page refresh)
- [ ] Cache vocabulary data for offline access
- [ ] Sync with server on reconnection

### 7. Progress Dashboard
- [ ] Visual learning progress tracking
- [ ] Words learned over time charts
- [ ] Difficult words analysis (frequently translated)

### 8. Named Entity Recognition
- [ ] Better detection of proper nouns and character names
- [ ] Use spaCy NER or similar for accurate detection
- [ ] Reduce false positives in fantasy content

### 9. Test Suite
- [ ] Add comprehensive pytest test suite for backend
- [ ] Add Jest tests for frontend components
- [ ] Document all API endpoints with examples

### 10. Spaced Repetition System (SRS)
- [ ] Implement SM-2 or similar algorithm
- [ ] Schedule word reviews based on retention
- [ ] Gamification with streaks
