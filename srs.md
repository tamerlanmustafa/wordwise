1. What your app currently does
Stars & XP (where they actually come from) — quiz-only.

api.ts:1149-1154: every completed quiz session returns {stars: 0-3, xp_earned, correct_count, total_scored}.
QuizResultScreen.tsx:188-200: 0–3 stars are awarded per session (3 = "Amazing", 2 = "Nice work", 1 = "Good try"). XP accumulates into user.xp; stars into total_stars.
LeaderboardScreen.tsx:35-36,58: leaderboard ranks on stars, xp, or retention.
Daily habit loop — already in place but thin.

dailyGoalStore.ts:39: DAILY_GOAL = 3 (sets/day).
dailyGoalStore.ts:138-147: streak increments only when the 3rd set lands and yesterday was either today already or yesterdayOf(today) — a single missed day resets to 0. No freeze, no repair.
JourneyScreen.tsx:229-246: pips + 🔥 streak count anchored top of the reel.
Reel — user-curated only.

reelStore.ts: tiles are added/removed by the user, auto-seeded once on first launch. No locked state. Tap → MoviePreviewHub → "Study words" or "Quiz me".
So your gut read is right: locking reel tiles is incoherent with the model — the user owns the list. And there's nothing today that forces them back tomorrow except the streak number itself.

2. What the research actually says
I tried to surface peer-reviewed work where it exists; some of the "Duolingo blog" findings are internal A/B and not academic, so I've flagged those.

Loss aversion is the engine of streaks. Kahneman & Tversky's prospect theory (foundational, peer-reviewed) shows losses are felt ~2× as strongly as equivalent gains. Streak design works because "don't lose what you have" is stronger than "earn more." Rewley et al. 2021 (peer-reviewed, Games for Health Journal) found loss-aversion effects only kick in when the thing being lost was earned, not gifted — meaning your streak only motivates if the user actually built it (matches Duolingo's "the first 7 days are the cliff").

The 7-day cliff is real. Duolingo's internal data (not peer-reviewed, but their N is enormous): learners hitting a 7-day streak are 3.6× more likely to complete the course and 2.4× more likely to return next day. The cliff is the first week, not month 1.

Streak freezes increase retention, not decrease it. Trophy.so analytics (industry, not academic): users on apps with freezes average 17.2 day streaks vs 11.6 without — a 48% lift. "Mercy infrastructure" beats strict streaks because it protects motivation on inevitable bad days. Your current store has no freeze and one slip wipes everything — this is the highest-leverage thing to add.

Spacing effect is the strongest peer-reviewed finding for vocab. Cepeda, Vul, Rohrer, Wixted & Pashler (2008, Psychological Science) — n=1,350, the canonical meta-analysis. Optimal review gap ≈ 10–20% of the desired retention interval. Translation: words you want to remember in a month want a review ~3-6 days after first encounter. Massed study (one-day cram) is the worst possible schedule for long-term retention.

Incidental vocab from video is real but weak alone. Peters & Webb (2018, Studies in Second Language Acquisition, peer-reviewed) — watching L2 TV produces small but reliable vocab gains, mediated by frequency of occurrence and prior knowledge. Captions help. Without spaced review, retention drops fast.

Variable rewards beat fixed rewards. Skinner's operant conditioning, validated in countless behavioral studies. Predictable rewards habituate. Apps that randomize what you get (not whether) maintain dopamine response.

Goal-gradient effect. Kivetz, Urminsky & Zheng (2006, Journal of Marketing Research, peer-reviewed) — coffee-card customers buy faster as they approach the free coffee, and the visual closeness to the goal matters. Your 3-pip strip already exploits this; the design choice is sound.

Tiny habits. BJ Fogg (Stanford Behavior Design Lab) — habit probability scales inversely with effort. A 2-minute routine becomes habitual far more reliably than 20 minutes. Duolingo's whole lesson length is engineered for this. Your "~2 min each" framing already does it.

3. How competitors handle the same problem
App	Daily unit	Streak protection	Variable reward	Movie-tied content
Duolingo	1 lesson (~3 min) + 3 daily quests	Streak freeze (free + purchasable), streak repair	Chests (bronze/silver/gold), gem rolls, random "double XP"	None — generic
FluentU	Daily Goals (XP target) + streak	Limited	Coins	Yes — video-tied, but daily unit is XP not videos
Yabla	Streak per video/exercise	Limited	Points only	Yes
Lingopie	Daily challenge — match saved vocab to meanings	Limited	Modest	This is closest to your model — daily review draws from words the user saved while watching
The pattern across the successful ones: the daily unit is short vocab review, not media consumption. Even FluentU, the most video-centric, makes the daily goal an XP target rather than a video count.

4. Diagnosis of your specific concern
You wrote: "if the user wants to see a movie and study before seeing it they would just do it in one day" — yes. This is correct and the spacing-effect literature confirms it's the wrong shape for a daily habit:

A movie is a content event (one-off, pre-watch cram or post-watch reinforcement).
Vocabulary retention is a review schedule (spaced over days/weeks).
These don't map 1:1. Trying to chunk one movie into 7 days of study fights both natural user behavior and the science — words from a single movie all encountered the same day still benefit from being reviewed 1, 3, 7 days later regardless of which movie they came from.

5. My recommendation
Don't pick "movie-daily" vs "Duolingo-daily." Layer them. Keep movies as the content source and trophy case. Make the daily habit a personal SRS review drawing from every movie the user has ever touched.

A. Reel tab — three concrete changes
Drop any lock idea. The reel becomes a queue + trophy case. Movies have visible status (Unstudied / Studied / Mastered) but nothing is gated.
Add a sticky "Today's 3 sets" CTA at the top — bigger than the pip strip. Tapping it starts a quiz drawing from words across all movies they've studied, picked by an SRS algorithm (due-today first, then near-due, then 1–2 fresh from the next unstudied movie in the reel). This is the daily habit. Movies are still tappable for one-shot pre-watch cram.
Each movie tile shows mastery progress (e.g. "12 / 47 words mastered"). When mastered → film-stamp "Final Cut" / "Director's Cut" cosmetic. Pure status, no gameplay block. Hits goal-gradient.
B. Streak protection — highest-ROI single addition
Auto-grant 1 streak freeze every Sunday (max 2 held). Wholly free, no purchase needed yet — this single change is likely to move retention more than anything else based on the 48% number.
Streak repair window: if user opens app within 24h of breaking, offer one-time "Catch up — do 6 sets today" to restore. Costs effort, not money.
C. Variable rewards in the daily 3
Right now all 3 sets are identical. Mirror Duolingo's bronze/silver/gold:

Set 1 (bronze chest): 5 due-review words from movies the user has already studied. Easiest. Always opens.
Set 2 (silver chest): 5 near-due + 1–2 brand-new words. Slightly harder.
Set 3 (gold chest): mixed + one 5-second clip from a movie scene where the word appears. This is the variable-reward hook — clip is randomly drawn, sometimes a famous line. Cinema-native, and it ties the daily habit back to the reason the user picked your app over Duolingo.
Chest contents are randomized: XP, a streak freeze, a poster frame cosmetic, occasionally double-XP for next session. Variable reward schedule.

D. What to "lock/unlock" (cosmetic, not gameplay)
You were right that locking the user's own movies makes no sense. Lock meta-rewards instead:

Streak milestones with cinema names: 7 = "Opening Weekend", 30 = "Box Office", 100 = "Cult Classic", 365 = "Criterion Collection". Each unlocks a poster frame / sprocket color / film-stock variant on the reel background.
CEFR badges: master N words at B1 → unlock the B1 badge stamp.
Genre achievements: master words from 3 sci-fi films → "Sci-Fi Fluent" badge.
These give long-term users something to chase without blocking short-term users from anything.

E. What to ditch / not build
Don't lock movies. Don't break a movie across "Day 1, Day 2, Day 3" — fights both behavior and the spacing literature.
Don't make the daily reel "generic words like Duolingo." That's your last-resort option for a reason — it throws away the differentiator. Words from the user's chosen movies is uniquely yours; words-in-general is a Duolingo clone.
6. The tradeoff to be aware of
The biggest shift here is conceptual: the reel tab stops being "a stack of movies" and becomes "a vocabulary engine backed by movies." The visual stays movie-centric (it's a film reel — keep that), but the primary daily action is the 3-set review, not browsing tiles. If you don't like that reframe, the alternative is to accept lower DAU and lean harder into the For-You / pre-movie cram flow as the value prop ("we make the movie you're about to watch comprehensible") rather than a daily-habit app at all. Both are valid products, but they want very different metrics.

Want me to sketch the SRS scheduling logic, design the chest/variable-reward backend changes, or mock up the new Reel header with "Today's 3 sets" as the primary CTA? Happy to do any of those — but flagging that this is still in proposal territory, so push back on anything that doesn't fit how you think about the product.

Sources:

Peer-reviewed:

Cepeda, Vul, Rohrer, Wixted & Pashler (2008) — Spacing effects in learning: a temporal ridgeline of optimal retention
Kivetz, Urminsky & Zheng (2006) — The Goal-Gradient Hypothesis Resurrected
Rewley et al. (2021) — Loss Aversion Explains Physical Activity Changes in a Behavioral Gamification Trial, Games for Health Journal
Peters & Webb (2018) — Incidental Vocabulary Acquisition through Viewing L2 Television, Studies in Second Language Acquisition
Montero Perez et al. — Incidental Vocabulary Learning through Viewing Video, Studies in Second Language Acquisition
Vocabulary Learning through Dual-Subtitled Videos: Immediate vs. Spaced Repetition (ReCALL, Cambridge)
Cepeda et al. (2006) — Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis
Industry / product:

Duolingo Blog — How streaks keep learners committed
Duolingo Blog — Habit research behind the streak
Duolingo Blog — Improving the streak: forming habits one lesson at a time
Trophy.so — Apps that use streaks, 10 examples (streak-freeze data)
Yu-kai Chou — Streak Design: 4 Rules Behind Duolingo's Loop
Deconstructor of Fun — Duolingo: gaming principles to supercharge DAU growth
Medium — Duolingo Streak System Detailed Breakdown
FluentU vs Lingopie comparison (2026)
Lingopie review with daily-challenge details (FluentU blog)
Yabla vs FluentU
