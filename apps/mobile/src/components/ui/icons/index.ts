/**
 * Drawn icons. No emoji anywhere in the app's UI.
 *
 * An emoji is drawn by the operating system in a font we do not control. It
 * ignores the palette, changes shape between iOS and Android and between OS
 * versions, sits on the text baseline instead of in the layout box, cannot be
 * lit or dimmed to match the state it reports, and renders as a monochrome
 * outline without a variation selector — which is why 🛡️ carried one. These
 * replace every one of them.
 *
 * `StreakFlame` (../StreakFlame) is the reference implementation and stays
 * where it is; `iconMotion` is its animation contract, extracted so the rest
 * of the set follows the same rules rather than a copy of them.
 */

export {
  StarIcon,
  ShieldIcon,
  ConfettiIcon,
  MedalIcon,
  LockIcon,
  type IconProps,
  type StarIconProps,
  type MedalIconProps,
} from './RewardIcons';

export {
  FilmIcon,
  SpeakerIcon,
  HeartIcon,
  FlagIcon,
  SparkleIcon,
  BoltIcon,
  BlockIcon,
  BrainIcon,
  ChartIcon,
  FamilyIcon,
  LevelDot,
  LEVEL_DOT_COLORS,
  type AppIconProps,
  type FilmIconProps,
  type SpeakerIconProps,
  type HeartIconProps,
} from './AppIcons';

export { useReduceMotion, pingPong, twinkle, useIconLoops, useAnimatedValues } from './iconMotion';
