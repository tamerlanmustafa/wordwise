/**
 * The icon font is loaded at launch, before any screen draws an icon.
 *
 * `@expo/vector-icons` decides at construction whether its font is loaded.
 * If not, the icon renders an empty <Text />, loads the font on mount, and
 * pops in a moment later. Measured on the Practice header after a cold start:
 * the freezes chevron missing for ~120ms after the rest of the panel had
 * painted. Every screen whose icon is the first one of the session did the
 * same — which is why this is loaded once, globally, rather than patched where
 * it was noticed.
 *
 * Nothing at runtime would catch this coming back: the icon still appears.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') walk(full, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('icon fonts are preloaded', () => {
  const app = fs.readFileSync(path.join(SRC, 'core', 'App.tsx'), 'utf8');

  it('loads Ionicons at launch', () => {
    expect(app).toMatch(/Ionicons\.loadFont\(\)/);
  });

  it('preloads every icon family the app imports', () => {
    // A second family added later would pop in exactly as Ionicons did.
    const families = new Set<string>();
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/import \{([^}]*)\} from '@expo\/vector-icons'/g)) {
        m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((f) => families.add(f));
      }
    }
    expect(families.size).toBeGreaterThan(0);
    for (const family of families) {
      expect(app).toMatch(new RegExp(`${family}\\.loadFont\\(\\)`));
    }
  });
});
