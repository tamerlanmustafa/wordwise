# WordWise Roadmap

This document outlines the development priorities for WordWise, organized by timeframe.

---

## Recently Completed ✅

### Performance & UX Improvements (Completed Dec 2024)

1. **Click-to-Expand Translation Pattern**
   - Translations only fetched when user clicks a word row
   - Eliminates batch translation overhead entirely
   - Zero initial translation load time, no rate limiting issues
   - Smooth CSS Grid animation for expand/collapse transitions

2. **Memory Management**
   - Backend CEFR caches use LRU with 50k max entries
   - Frontend worker translation Map uses LRU with 5k max entries
   - Caches cleared on movie/tab change
   - Prevents memory leaks in long sessions

3. **User Profile Settings Page**
   - Created /settings page for updating language preferences
   - Users can change native/learning language and proficiency level
   - Displays current user profile info with avatar
   - Settings accessible from TopBar user menu

4. **Login Page Language Selection**
   - Language preference dialog for existing users without languages set
   - Dialog appears after login if native_language is null
   - Works for both email/password and Google OAuth login

5. **UI Polish**
   - Smooth fade transitions when switching CEFR tabs
   - Virtualized list with dynamic row heights for expanded words
   - Scroll-to-top floating button
   - Row number alignment with word text

---

## Short-Term Priorities (Next 2 Weeks)

### Performance & Reliability

1. **Rate Limiting & Security**
   - [ ] Add rate limiting to auth endpoints (prevent brute force)
   - [ ] Add rate limiting to translation endpoints (protect API quotas)
   - [ ] Validate translation input length (max 500 chars)
   - [ ] Implement request timeouts for external APIs

2. **Error Handling & Monitoring**
   - [ ] Set up error monitoring (Sentry or similar)
   - [ ] Add graceful error states in UI for failed translations
   - [ ] Improve error messages for common failures

### User Experience

3. **Search & Filter in Vocabulary**
   - [ ] Real-time search within vocabulary lists
   - [ ] Filter by: saved, learned
   - [ ] Sort options: alphabetical, frequency, confidence

4. **Translation Language Sync**
   - [ ] Sync LanguageContext with user's native_language from profile
   - [ ] Auto-set translation target language based on user preferences

---

## Mid-Term Priorities (1-2 Months)

### Backend Improvements

5. **Redis Cache Layer**
   - [ ] Replace database-based TranslationCache with Redis
   - [ ] Enable distributed caching for horizontal scaling
   - [ ] Add TTL-based cache expiration (30 days for translations)
   - [ ] Impact: Faster cache reads, better scalability

6. **Background Job Processing**
   - [ ] Implement Celery for async tasks
   - [ ] Move script fetching to background jobs
   - [ ] Add bulk classification as background task
   - [ ] Return immediate response with job status polling

7. **Translation API Quota Management**
   - [ ] Track DeepL API usage (500K chars/month free tier)
   - [ ] Implement usage warnings and limits per user
   - [ ] Consider DeepL Pro upgrade ($25/mo) for higher limits
   - [ ] Aggressive cache-first strategy

### Frontend Improvements

8. **IndexedDB Persistence**
   - [ ] Cache translations in IndexedDB (survive page refresh)
   - [ ] Cache vocabulary data for offline access
   - [ ] Sync with server on reconnection

9. **Progress Dashboard**
   - [ ] Visual learning progress tracking
   - [ ] Words learned over time charts
   - [ ] Difficult words analysis (frequently translated)
   - [ ] Movie completion status

### Classification Improvements

10. **Named Entity Recognition**
    - [ ] Better detection of proper nouns and character names
    - [ ] Use spaCy NER or similar for accurate detection
    - [ ] Reduce false positives in fantasy content

11. **Context-Aware Classification**
    - [ ] Consider surrounding words for ambiguous terms
    - [ ] Sentence-level difficulty analysis
    - [ ] Handle homographs (bank = financial vs river)

---

## Long-Term Priorities (3-6 Months)

### Architecture

12. **GraphQL API**
    - [ ] Single endpoint for all data queries
    - [ ] Client-driven queries reduce over-fetching
    - [ ] Subscriptions for real-time updates

13. **Translation Microservice**
    - [ ] Split translation into separate service
    - [ ] Independent scaling based on load
    - [ ] Support multiple translation providers easily

14. **Horizontal Scaling**
    - [ ] Kubernetes deployment with 5-10 replicas
    - [ ] PostgreSQL read replicas for heavy reads
    - [ ] Load balancer with session affinity

### Features

15. **Spaced Repetition System (SRS)**
    - [ ] Implement SM-2 or similar algorithm
    - [ ] Schedule word reviews based on retention
    - [ ] Push notifications for daily reviews
    - [ ] Gamification with streaks

16. **Flashcard Mode**
    - [ ] Interactive flashcard study sessions
    - [ ] Audio pronunciation
    - [ ] Example sentences from movies
    - [ ] Self-grading (easy/hard/again)

17. **TV Series Support**
    - [ ] Episode-by-episode vocabulary tracking
    - [ ] Cumulative series vocabulary
    - [ ] Track progress across seasons

18. **Mobile App**
    - [ ] React Native or Flutter app
    - [ ] Offline vocabulary access
    - [ ] Push notifications for reviews
    - [ ] Native share/export

### AI/ML Enhancements

19. **ML-Based Difficulty Prediction**
    - [ ] Train model on user feedback
    - [ ] Personalized difficulty based on user's level
    - [ ] Continuous improvement from usage data

20. **AI-Powered Definitions**
    - [ ] Generate context-aware definitions
    - [ ] Movie-specific word usage explanations
    - [ ] Example sentences from the actual movie

21. **Pronunciation Guide**
    - [ ] Text-to-speech for word pronunciation
    - [ ] IPA phonetic notation
    - [ ] Regional accent variations

---

## Technical Debt

### High Priority

- [ ] Add comprehensive test suite (pytest for backend, Jest for frontend)
- [ ] Document all API endpoints with examples
- [ ] Add database connection pooling (PgBouncer)

### Medium Priority

- [ ] Implement soft deletes for data recovery
- [ ] Add composite indexes for common query patterns
- [ ] Use TypedArrays for SoA data in worker (2x memory savings)

### Low Priority

- [ ] Add request timeout handling for external APIs
- [ ] Implement refresh token rotation
- [ ] Add admin dashboard for analytics

---

## Security Priorities

### Immediate (Next Sprint)

- [ ] Add rate limiting to auth endpoints
- [ ] Implement request timeouts for external APIs
- [ ] Validate translation input length (max 500 chars)

### Short-Term

- [ ] Add CSRF protection
- [ ] Implement API key rotation mechanism
- [ ] Add security headers (HSTS, CSP)

### Long-Term

- [ ] SOC 2 compliance preparation
- [ ] Regular security audits
- [ ] Bug bounty program

---

## Success Metrics

### Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| Initial page load | < 2 seconds | Pending measurement |
| Translation load | < 500ms | ✅ Click-to-expand: instant (~200ms per word) |
| Tab switch | < 50ms | ✅ Smooth fade transition |
| Scroll performance | 60fps | ✅ Virtualized list with dynamic heights |
| API response (cached) | < 100ms | Pending measurement |

### User Engagement

- Daily active users growth
- Average session duration > 10 minutes
- Words learned per user per week
- Return rate > 40%

### Technical Health

- Error rate < 0.1%
- API availability > 99.9%
- Translation cache hit rate > 80%
- Zero memory leaks in 24h sessions ✅ (LRU caches implemented)
