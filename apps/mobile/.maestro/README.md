# UI stress flows

Black-box flows that drive a **real build** on a simulator or device. They are
the half of the test suite jest cannot reach: the jest suite is logic and
integration only by project rule (no component-render library), so nothing in
it ever touches a real button, a real animation, or the OS underneath them.

What these are for is **stress**, not smoke. Every flow here does the thing a
user does when they are impatient — tap before the last tap has landed, switch
tabs mid-animation, spam Back, background the app in the middle of a session.
That is where this app's bugs have actually lived: a deck torn down by a 140ms
timer that kept re-arming, a screen that remounted on every tab toggle, a card
count still settling while the reader was away. None of those needed an unusual
button. They needed an unusual *rhythm*.

## Running them

Maestro is not a project dependency and is not installed by `npm ci` — it is a
standalone binary, and it needs a JDK (it is a Kotlin CLI):

```sh
brew install openjdk
curl -Ls "https://get.maestro.mobile.dev" | bash      # installs to ~/.maestro
export JAVA_HOME=/opt/homebrew/opt/openjdk
export PATH="$JAVA_HOME/bin:$PATH:$HOME/.maestro/bin"
```

Then build and install the app once (these drive an installed binary, they do
not build one):

```sh
cd apps/mobile
npx expo run:ios          # or: npx expo run:android
```

> `expo run:ios` picks a **physical device** if one is plugged in. Use
> `xcodebuild` with an explicit simulator destination if that happens — see the
> `apps/mobile:verify` skill.

Then:

```sh
maestro test .maestro/                  # everything
maestro test .maestro/tab-storm.yaml    # one flow
maestro studio                          # interactive, for writing new ones
```

## Not in CI, on purpose

CI runs `tsc` + jest on ubuntu in about a minute. These need a built app and a
booted simulator, which is a different machine class and a different order of
magnitude in time. Wiring them into the PR gate would make every pull request
wait on a simulator boot for a class of bug that lands a few times a year.

Run them before a store build, and after any change to navigation, the tab bar,
or a screen's mount/unmount behaviour.

## Writing a new one: you will need a testID first

**React Native does not expose a view to iOS accessibility unless it is
explicitly marked**, and XCUITest — which is what Maestro drives on iOS — can
only see what accessibility exposes. Dumped on a running build, the entire app
produced *four* text nodes, and all four belonged to the iOS status bar. Not
the film titles, not the headword, not the word "Next" printed on a gold
button 40 points high.

So a flow cannot match on visible text here. Anything a flow needs to touch
has to carry a `testID` (plus `accessibilityRole` and `accessibilityLabel`,
which are worth adding anyway — they are the same props a screen reader needs).
The ones that exist so far:

| testID | what |
|---|---|
| `tab-words` `tab-films` `tab-practice` `tab-lists` `tab-profile` | bottom bar |
| `film-card-<tmdbId>` | a card in the film feed |
| `deck-next` `deck-knew-it` `deck-previous` `deck-card` | the word deck |

Prefer `testID` over text even where text would work. Labels are translated,
and the tab labels are actively *misleading*: the tab labelled "Home" shows the
word feed and "Explore" shows films (the labels were swapped once and the route
ids were not).

## The backend

Dev builds hit `http://localhost:8000` — hard-coded in `src/config/env.ts`,
with no env override — so `deck-storm` and anything else that opens a film
needs the API running:

```sh
cd backend && uvicorn src.main:app --port 8000
```

Without it, films already in the offline cache still open and everything else
shows its empty state. `tab-storm`, `back-spam`, `panel-teardown` and
`cold-restart` do not need the API at all; they are navigation, and navigation
is exactly the bug class these exist for.

A stress flow should end by asserting the app is still *responsive* — that a
known element is visible and tappable — rather than asserting a specific
screen. The failure these catch is a frozen or blank UI, not a wrong route.

## Status — all five run green (2026-09-10)

Run against the Debug build on the "iPhone 17 Pro" simulator, JS served by
Metro.

| flow | result |
|---|---|
| `tab-storm` | passed — 130 tab taps, no settle between them |
| `back-spam` | passed — 12 deep-and-out cycles, then 8 backs on a root tab |
| `panel-teardown` | passed — 15 open/dismiss, 6 open/back/back |
| `cold-restart` | passed — 8 kill-and-relaunch cycles |
| `deck-storm` | passed — 20 Next, 10 Knew-it, 30 swipes, 20 card taps |

Two things the first run cost, both now fixed in place: `swipe` takes
`start`/`end`, not `from`/`to`; and every selector had to move from visible
text to `testID`, for the accessibility reason above.

Worth recording from `deck-storm`: the header read `CARD 11 / 60` at the end,
having read `CARD 1 / 60` at the start. The total held at 60 through ~70
interactions — which is the fix from `deck-count-stability` confirmed on a
device rather than in a unit test.
