# WordWise Roadmap

This document outlines the development priorities for WordWise, organized by timeframe.

## Short-Term Priorities (1-2 Weeks)

### Critical Fixes

1. **Translation Performance**
   - [ ] Implement parallel translation API calls with `asyncio.gather()` and Semaphore(5)
   - [ ] Current: 50 words × 200ms = 10 seconds sequential
   - [ ] Target: 50 words / 5 parallel = 2 seconds
   - [ ] Impact: 5x faster translation loading

2. **Memory Management**
   - [ ] Add LRU cache eviction to backend CEFR caches (`functools.lru_cache(maxsize=50000)`)
   - [ ] Add LRU eviction to frontend worker translation Map
   - [ ] Clear translation/word caches on movie/tab change
   - [ ] Impact: Prevents memory leaks in long sessions

3. **Viewport-First Translation**
   - [ ] Prioritize translations for visible words only
   - [ ] Background-load off-screen words
   - [ ] Impact: Instant perceived load time

### User Experience

4. **User Profile Settings Page**
   - [ ] Create settings page for updating language preferences
   - [ ] Allow users to change native/learning language after signup
   - [ ] Display current user profile information

5. **Login Page Language Selection**
   - [ ] Add language preference prompts for existing users without languages set
   - [ ] Migrate existing users to have language preferences

## Mid-Term Priorities (1-2 Months)

### Backend Improvements

6. **Redis Cache Layer**
   - [ ] Replace database-based TranslationCache with Redis
   - [ ] Enable distributed caching for horizontal scaling
   - [ ] Add TTL-based cache expiration (30 days for translations)
   - [ ] Impact: Faster cache reads, better scalability

7. **Background Job Processing**
   - [ ] Implement Celery for async tasks
   - [ ] Move script fetching to background jobs
   - [ ] Add bulk classification as background task
   - [ ] Return immediate response with job status polling

8. **Translation API Quota Management**
   - [ ] Track DeepL API usage (500K chars/month free tier)
   - [ ] Implement usage warnings and limits per user
   - [ ] Consider DeepL Pro upgrade ($25/mo) for higher limits
   - [ ] Aggressive cache-first strategy

### Frontend Improvements

9. **IndexedDB Persistence**
   - [ ] Cache translations in IndexedDB (survive page refresh)
   - [ ] Cache vocabulary data for offline access
   - [ ] Sync with server on reconnection

10. **Search & Filter in Vocabulary**
    - [ ] Real-time search within vocabulary lists
    - [ ] Filter by: saved, learned, translated
    - [ ] Sort options: alphabetical, frequency, confidence

11. **Progress Dashboard**
    - [ ] Visual learning progress tracking
    - [ ] Words learned over time charts
    - [ ] Difficult words analysis (frequently translated)
    - [ ] Movie completion status

### Classification Improvements

12. **Named Entity Recognition**
    - [ ] Better detection of proper nouns and character names
    - [ ] Use spaCy NER or similar for accurate detection
    - [ ] Reduce false positives in fantasy content

13. **Context-Aware Classification**
    - [ ] Consider surrounding words for ambiguous terms
    - [ ] Sentence-level difficulty analysis
    - [ ] Handle homographs (bank = financial vs river)

## Long-Term Priorities (3-6 Months)

### Architecture

14. **GraphQL API**
    - [ ] Single endpoint for all data queries
    - [ ] Client-driven queries reduce over-fetching
    - [ ] Subscriptions for real-time updates

15. **Translation Microservice**
    - [ ] Split translation into separate service
    - [ ] Independent scaling based on load
    - [ ] Support multiple translation providers easily

16. **Horizontal Scaling**
    - [ ] Kubernetes deployment with 5-10 replicas
    - [ ] PostgreSQL read replicas for heavy reads
    - [ ] Load balancer with session affinity

### Features

17. **Spaced Repetition System (SRS)**
    - [ ] Implement SM-2 or similar algorithm
    - [ ] Schedule word reviews based on retention
    - [ ] Push notifications for daily reviews
    - [ ] Gamification with streaks

18. **Flashcard Mode**
    - [ ] Interactive flashcard study sessions
    - [ ] Audio pronunciation
    - [ ] Example sentences from movies
    - [ ] Self-grading (easy/hard/again)

19. **TV Series Support**
    - [ ] Episode-by-episode vocabulary tracking
    - [ ] Cumulative series vocabulary
    - [ ] Track progress across seasons

20. **Mobile App**
    - [ ] React Native or Flutter app
    - [ ] Offline vocabulary access
    - [ ] Push notifications for reviews
    - [ ] Native share/export

### AI/ML Enhancements

21. **ML-Based Difficulty Prediction**
    - [ ] Train model on user feedback
    - [ ] Personalized difficulty based on user's level
    - [ ] Continuous improvement from usage data

22. **AI-Powered Definitions**
    - [ ] Generate context-aware definitions
    - [ ] Movie-specific word usage explanations
    - [ ] Example sentences from the actual movie

23. **Pronunciation Guide**
    - [ ] Text-to-speech for word pronunciation
    - [ ] IPA phonetic notation
    - [ ] Regional accent variations

## Technical Debt

### High Priority

- [ ] Add comprehensive test suite (pytest for backend, Jest for frontend)
- [ ] Implement rate limiting on API endpoints
- [ ] Add request size limits for translation inputs
- [ ] Set up error monitoring (Sentry)

### Medium Priority

- [ ] Add database connection pooling (PgBouncer)
- [ ] Implement soft deletes for data recovery
- [ ] Add composite indexes for common query patterns
- [ ] Document all API endpoints with examples

### Low Priority

- [ ] Use TypedArrays for SoA data in worker (2x memory savings)
- [ ] Add request timeout handling for external APIs
- [ ] Implement refresh token rotation
- [ ] Add admin dashboard for analytics

## Security Priorities

1. **Immediate**
   - [ ] Add rate limiting to auth endpoints
   - [ ] Implement request timeouts for external APIs
   - [ ] Validate translation input length (max 500 chars)

2. **Short-Term**
   - [ ] Add CSRF protection
   - [ ] Implement API key rotation mechanism
   - [ ] Add security headers (HSTS, CSP)

3. **Long-Term**
   - [ ] SOC 2 compliance preparation
   - [ ] Regular security audits
   - [ ] Bug bounty program

## Success Metrics

### Performance Targets
- Initial page load: < 2 seconds
- Translation load (visible words): < 500ms
- Tab switch: < 50ms
- Scroll: 60fps consistently
- API response (cached): < 100ms

### User Engagement
- Daily active users growth
- Average session duration > 10 minutes
- Words learned per user per week
- Return rate > 40%

### Technical Health
- Error rate < 0.1%
- API availability > 99.9%
- Translation cache hit rate > 80%
- Zero memory leaks in 24h sessions
