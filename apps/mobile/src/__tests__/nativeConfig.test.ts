/**
 * Source-level guards on the bare-workflow native config (issue #160).
 *
 * `apps/mobile` commits `android/` and `ios/`. When those folders are present,
 * EAS Build ignores a fixed set of `app.json` properties and reads the native
 * code instead — silently, with no error. For months `app.json` declared four
 * config plugins, an orientation, a scheme and a splash screen that no build has
 * ever applied. They worked only because the same settings were already baked
 * into the native folders, so nothing looked broken.
 *
 * That is the dangerous shape: the file you would naturally edit is not the file
 * that is read. A fifth plugin added to `app.json` would do nothing at all.
 *
 * The 2026-08-23 decision was to stay bare (see the issue), so these tests pin
 * both halves of it:
 *
 *  1. `app.json` must not re-grow the properties the build ignores. This is not
 *     hypothetical — `npx expo install --fix` re-added a `plugins: ["expo-web-browser"]`
 *     block during the very change that removed it, which is exactly how the
 *     original drift started.
 *  2. Every value deleted from `app.json` must still be present natively. A
 *     deletion is only safe while the native folders actually carry the setting,
 *     so the test reads them rather than trusting the migration.
 *
 * If the project is ever converted to CNG/prebuild, this file should be deleted
 * as part of that change — deliberately, not by deleting failing assertions.
 */

import fs from 'fs';
import path from 'path';

const MOBILE = path.join(__dirname, '..', '..');
const REPO = path.join(MOBILE, '..', '..');

function readMobile(...rel: string[]): string {
  return fs.readFileSync(path.join(MOBILE, ...rel), 'utf8');
}

function readRepo(...rel: string[]): string {
  return fs.readFileSync(path.join(REPO, ...rel), 'utf8');
}

/** The brand near-black the splash screen paints on both platforms. */
const SPLASH_HEX = '#0e0d10';

const appJsonRaw = readMobile('app.json');
const appJson = JSON.parse(appJsonRaw) as { expo: Record<string, unknown> };

describe('the project is bare, and app.json knows it', () => {
  it('commits the native folders, which is what makes the rest of this file apply', () => {
    expect(fs.existsSync(path.join(MOBILE, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'))).toBe(true);
    expect(fs.existsSync(path.join(MOBILE, 'ios', 'WordWise', 'Info.plist'))).toBe(true);
  });

  /**
   * Verbatim from `expo-doctor`: "When the android/ios folders are present, EAS
   * Build will not sync the following properties". Anything here in `app.json`
   * is a lie the build never reads.
   */
  const IGNORED_BY_EAS = [
    'orientation',
    'icon',
    'userInterfaceStyle',
    'scheme',
    'splash',
    'plugins',
    'ios',
    'android',
  ];

  it.each(IGNORED_BY_EAS)('does not declare "%s" — EAS Build would ignore it', (key) => {
    expect(appJson.expo).not.toHaveProperty(key);
  });

  it('does not declare entryPoint, which is not a valid Expo config field', () => {
    // Fails `expo-doctor`'s schema check, and in a bare project the entry point
    // comes from the native code regardless.
    expect(appJson.expo).not.toHaveProperty('entryPoint');
    expect(JSON.parse(appJsonRaw)).not.toHaveProperty('entryPoint');
  });

  it('keeps the fields the build and EAS Update DO read', () => {
    expect(appJson.expo.slug).toBe('wordwise-mobile');
    expect(appJson.expo.runtimeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(appJson.expo.updates).toEqual({
      url: 'https://u.expo.dev/672b17ee-a16a-4162-8666-f93b98681c5f',
    });
  });

  it('declares the same runtimeVersion as both native builds', () => {
    // The one that bites. `runtimeVersion` is a hardcoded string here, not a
    // policy, so adding a native module does NOT bump it — an OTA update then
    // gets *delivered* to binaries that lack the module and crashes them on
    // launch, instead of being withheld as incompatible. Bumping it is the
    // manual step that makes old installs ineligible, and bumping it in one
    // of the three files and not the others is the same bug with extra steps.
    const declared = appJson.expo.runtimeVersion;
    expect(readMobile('ios', 'WordWise', 'Supporting', 'Expo.plist')).toContain(
      `<key>EXUpdatesRuntimeVersion</key>\n    <string>${declared}</string>`,
    );
    expect(
      readMobile('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    ).toContain(`<string name="expo_runtime_version">${declared}</string>`);
  });
});

describe('the settings deleted from app.json are still applied natively', () => {
  const manifest = readMobile('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const infoPlist = readMobile('ios', 'WordWise', 'Info.plist');
  const buildGradle = readMobile('android', 'app', 'build.gradle');
  const pbxproj = readMobile('ios', 'WordWise.xcodeproj', 'project.pbxproj');

  it('orientation is portrait on both platforms', () => {
    expect(manifest).toContain('android:screenOrientation="portrait"');
    expect(infoPlist).toContain('UIInterfaceOrientationPortrait');
  });

  it('the wordwise:// scheme is registered on both platforms', () => {
    expect(manifest).toContain('<data android:scheme="wordwise"/>');
    expect(infoPlist).toContain('<string>wordwise</string>');
  });

  it('userInterfaceStyle: automatic survives as DayNight / Automatic', () => {
    expect(readMobile('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml')).toContain(
      'Theme.AppCompat.DayNight.NoActionBar'
    );
    expect(infoPlist).toContain('<key>UIUserInterfaceStyle</key>');
    expect(infoPlist).toMatch(/UIUserInterfaceStyle<\/key>\s*<string>Automatic<\/string>/);
  });

  it('the bundle identifier matches across both platforms', () => {
    expect(buildGradle).toContain("applicationId 'com.wordwise.mobile'");
    expect(pbxproj).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.wordwise.mobile;');
  });

  /**
   * The four plugins `app.json` used to declare. None of them were ever applied
   * by a build; these are the native artifacts they had already produced, and
   * they are now the only thing keeping the features working.
   */
  describe('the four ex-plugins left native output behind', () => {
    it('expo-apple-authentication: the Sign in with Apple entitlement', () => {
      expect(readMobile('ios', 'WordWise', 'WordWise.entitlements')).toContain(
        'com.apple.developer.applesignin'
      );
    });

    it('@react-native-google-signin: the reversed-client URL scheme', () => {
      expect(infoPlist).toContain(
        'com.googleusercontent.apps.400446242104-a9laa57dook0og2k93g9amjgieqo2mj7'
      );
    });

    it('expo-media-library: both Photos permission strings', () => {
      expect(infoPlist).toContain('<key>NSPhotoLibraryUsageDescription</key>');
      expect(infoPlist).toContain('<key>NSPhotoLibraryAddUsageDescription</key>');
    });
  });
});

describe('the splash screen paints the same colour on both platforms', () => {
  /**
   * Fixed as part of #160. iOS had drifted to `systemBackgroundColor` — white in
   * light mode — while `app.json` claimed #0e0d10 and Android actually used it.
   * The storyboard also carried constraints to a view it no longer contained and
   * declared a `SplashScreenLogo` image with no imageset behind it.
   */
  it('Android paints the brand near-black', () => {
    expect(readMobile('android', 'app', 'src', 'main', 'res', 'values', 'colors.xml')).toContain(
      `<color name="splashscreen_background">${SPLASH_HEX}</color>`
    );
  });

  it('iOS reads its background from the named colour, not the system default', () => {
    const storyboard = readMobile('ios', 'WordWise', 'SplashScreen.storyboard');
    expect(storyboard).toContain('<color key="backgroundColor" name="SplashScreenBackground"/>');
    expect(storyboard).not.toContain('systemBackgroundColor');
  });

  it('iOS has no dangling references to the removed logo view', () => {
    const storyboard = readMobile('ios', 'WordWise', 'SplashScreen.storyboard');
    // Both used to point at things that did not exist: a subview that had been
    // deleted, and an imageset that was never in Images.xcassets.
    expect(storyboard).not.toContain('EXPO-SplashScreen');
    expect(storyboard).not.toContain('SplashScreenLogo');
  });

  it('the iOS colourset resolves to exactly the Android colour', () => {
    const colorset = JSON.parse(
      readMobile('ios', 'WordWise', 'Images.xcassets', 'SplashScreenBackground.colorset', 'Contents.json')
    ) as { colors: { color: { components: Record<string, string> } }[] };

    const { red, green, blue } = colorset.colors[0].color.components;
    const toHex = (component: string) =>
      Math.round(parseFloat(component) * 255)
        .toString(16)
        .padStart(2, '0');

    expect(`#${toHex(red)}${toHex(green)}${toHex(blue)}`).toBe(SPLASH_HEX);
  });
});

describe('.easignore keeps the build upload small', () => {
  const easignore = readRepo('.easignore');

  it('exists and excludes the backend ML models, which are 103 MB a mobile build never reads', () => {
    expect(easignore).toContain('/backend/');
  });

  /**
   * The trap this file exists to survive: a `.easignore` REPLACES `.gitignore`
   * for the upload rather than adding to it. A minimal `.easignore` listing only
   * `.expo/` would start uploading node_modules and ios/Pods — around 1.4 GB from
   * apps/mobile alone — making the archive far bigger than having no file at all.
   */
  const rules = easignore.split('\n').map((line) => line.trim());

  it.each(['**/node_modules/', '**/Pods/', '**/build/'])(
    're-declares "%s", which .gitignore no longer covers for the upload',
    (pattern) => {
      // Matched as a whole line, not a substring: `toContain` on the raw text is
      // satisfied by any rule that merely *contains* the pattern, so it would
      // still pass after the real rule was deleted. A mutation run caught that.
      expect(rules).toContain(pattern);
    }
  );

  it('keeps packages/, which tsconfig maps @wordwise/types onto', () => {
    expect(easignore).not.toMatch(/^\/?packages\/$/m);
  });

  it('never uploads env files', () => {
    expect(easignore).toContain('.env');
  });
});

describe('local Expo state stays out of git', () => {
  it('.expo/ is ignored', () => {
    // It holds devices.json and settings.json alongside build logs. The root
    // .gitignore's `*.log` rule caught only the logs, which is why nothing had
    // leaked yet and why the gap was easy to miss.
    expect(readMobile('.gitignore')).toMatch(/^\.expo\/$/m);
  });
});
