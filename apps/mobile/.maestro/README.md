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
standalone binary:

```sh
curl -Ls "https://get.maestro.mobile.dev" | bash      # installs to ~/.maestro
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

## Writing a new one

Target `testID` over visible text. The labels are translated, and the tab
labels in particular are *misleading*: the tab labelled "Home" shows the word
feed and the one labelled "Explore" shows films (the labels were swapped once
and the route ids were not). `testID="tab-words"` is unambiguous; `"Home"` is
not.

A stress flow should end by asserting the app is still *responsive* — that a
known element is visible and tappable — rather than asserting a specific
screen. The failure these catch is a frozen or blank UI, not a wrong route.

## Status

**These flows have not been run against a build.** They were written from the
source and are syntactically plausible, not verified. Treat the first run as
part of writing them: expect selectors to need adjusting, and fix them here
rather than working around them.
