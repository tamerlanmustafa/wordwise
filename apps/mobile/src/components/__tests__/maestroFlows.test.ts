/**
 * The UI flows and the app they drive stay in step.
 *
 * The flows in `.maestro/` cannot run in CI — they need a built app and a
 * booted simulator — so nothing tells you when one goes stale. A selector that
 * stopped matching does not fail loudly the next time someone runs the suite;
 * it fails six weeks later, in front of whoever was about to cut a store
 * build, and by then the change that broke it is long merged.
 *
 * This is the cheap half of that problem, and the half a jest run CAN answer:
 * the handles the flows reach for still exist in the source. It says nothing
 * about whether a tap lands or a screen appears — only that the flows are not
 * addressing something the app stopped rendering.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const MAESTRO = path.join(SRC, '..', '.maestro');

const flowFiles = () =>
  fs.readdirSync(MAESTRO).filter((f) => f.endsWith('.yaml')).sort();
const flow = (name: string) => fs.readFileSync(path.join(MAESTRO, name), 'utf8');
const allFlows = () => flowFiles().map(flow).join('\n');

const bottomBar = () =>
  fs.readFileSync(path.join(SRC, 'components', 'GlobalBottomBar.tsx'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Route ids from the one place content, label and position meet. */
function tabIds(): string[] {
  const src = bottomBar();
  const block = src.slice(src.indexOf('export const TABS'), src.indexOf('];', src.indexOf('export const TABS')));
  return [...block.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('the flows address handles the app still renders', () => {
  it('finds flows at all', () => {
    // A source guard whose input silently became empty reports zero problems
    // and looks like success for ever.
    expect(flowFiles().length).toBeGreaterThanOrEqual(4);
  });

  it('gives the controls the flows drive a testID', () => {
    // React Native exposes a view to iOS accessibility only when it is
    // explicitly marked, and XCUITest can see nothing else. Dumped on a
    // running build, the whole app produced four text nodes and all four were
    // the iOS status bar — so a flow cannot match on visible text here, and
    // any control a flow touches has to carry one of these.
    const files: [string, string[]][] = [
      ['components/GlobalBottomBar.tsx', ['tab-${id}']],
      ['components/filmFeed/RankedMovieList.tsx', ['film-card-']],
      [
        'components/vocabulary/WordCardDeck.tsx',
        ['deck-next', 'deck-knew-it', 'deck-previous', 'deck-card'],
      ],
    ];
    for (const [file, ids] of files) {
      const src = fs.readFileSync(path.join(SRC, file), 'utf8');
      for (const id of ids) expect(src).toContain(id);
    }
  });

  it('never reaches for a testID nothing renders', () => {
    // The other direction: a flow addressing an id the app dropped fails six
    // weeks later, in front of whoever was cutting a store build.
    const rendered = new Set<string>();
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/testID=\{?["'`]([a-z-]+)/g)) rendered.add(m[1]);
      for (const m of src.matchAll(/testID=\{`([a-z-]+)-\$/g)) rendered.add(m[1] + '-');
    }
    const referenced = [...allFlows().matchAll(/id:\s*'([a-z][a-z-]*)/g)].map((m) => m[1]);
    const unknown = [...new Set(referenced)].filter(
      (id) => !rendered.has(id) && ![...rendered].some((r) => r.endsWith('-') && id.startsWith(r)),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every bottom-bar tab a stable testID', () => {
    // Not the visible label: it is translated, and the tab labelled "Home"
    // shows the WORD feed while "Explore" shows films — the labels were
    // swapped once and the route ids were not. A flow written against text
    // taps the wrong tab in every locale, including English.
    const src = bottomBar();
    expect(src).toMatch(/testID=\{`tab-\$\{id\}`\}/);
    expect(tabIds().length).toBeGreaterThanOrEqual(5);
  });

  it('never reaches for a tab that does not exist', () => {
    const ids = new Set(tabIds());
    const referenced = [...allFlows().matchAll(/id:\s*'tab-([a-zA-Z]+)'/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    const unknown = [...new Set(referenced)].filter((id) => !ids.has(id));
    expect(unknown).toEqual([]);
  });

  it('points every subflow at a file that is there', () => {
    const referenced = [...allFlows().matchAll(/runFlow:\s*([\w.-]+\.yaml)/g)].map((m) => m[1]);
    for (const name of referenced) {
      expect(fs.existsSync(path.join(MAESTRO, name))).toBe(true);
    }
  });

  it('names the app the build actually installs', () => {
    // A wrong appId fails with "app not installed", which reads as a broken
    // environment rather than as a stale flow.
    const gradle = fs.readFileSync(
      path.join(SRC, '..', 'android', 'app', 'build.gradle'),
      'utf8',
    );
    const applicationId = gradle.match(/applicationId\s+'([^']+)'/)?.[1];
    expect(applicationId).toBeTruthy();
    for (const name of flowFiles()) {
      expect(flow(name)).toContain(`appId: ${applicationId}`);
    }
  });
});

describe('the flows are stress flows, not smoke tests', () => {
  it('repeats something, in every flow that is not shared setup', () => {
    // The point of these is rhythm, not coverage. A flow that walks a path
    // once is testing that the path exists, which jest and a human already do.
    for (const name of flowFiles()) {
      if (name === 'film-open.yaml') continue; // shared setup, deliberately linear
      expect(flow(name)).toMatch(/repeat:/);
    }
  });

  it('ends by checking the app still answers', () => {
    // What a stress flow catches is a frozen or blank UI, so the last word has
    // to be an assertion that something is still on screen — not a screenshot,
    // which passes whatever it captured.
    for (const name of flowFiles()) {
      if (name === 'film-open.yaml') continue;
      expect(flow(name)).toMatch(/assert(Visible|NotVisible)|extendedWaitUntil/);
    }
  });
});
