/**
 * ShareCard — the image a word gets shared as.
 *
 * Drawn in SVG rather than laid out in React Native views, for one reason:
 * `react-native-svg` can rasterise itself with `toDataURL()`, natively, on
 * both platforms. Capturing a normal view tree needs `react-native-view-shot`,
 * a native module this app does not have — and adding one turns an OTA into a
 * store build. The card is entirely type and rectangles, which SVG draws
 * perfectly well, so the constraint costs nothing.
 *
 * It is rendered off-screen at full canvas size and never seen as a view. The
 * host mounts it, waits a frame, calls `toDataURL`, and unmounts.
 *
 * ## Why it looks like this
 *
 * A story card is read at a glance, in a feed, at thumbnail size before it is
 * tapped. So: one enormous word, one line of context, and the wordmark. No
 * translation — the point of posting a word is usually "look at this word",
 * and the answer belongs in the app rather than given away on the image.
 *
 * SVG has no text wrapping and no auto-shrink, so both are computed up front
 * in `shareCardLayout` where a test can check them. A line too long here does
 * not clip or error; it simply walks off the canvas into a PNG someone posts.
 */

import { forwardRef, useMemo } from 'react';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { cefrColors } from '../../theme/palette';
import { MONO_FAMILY, SERIF_FAMILY, SERIF_ITALIC_FAMILY } from '../../theme/fonts';
import {
  CARD_H,
  CARD_W,
  PADDING,
  SENTENCE_LINE_H,
  SENTENCE_SIZE,
  wordFontSize,
  wrapText,
} from './shareCardLayout';

export interface ShareCardProps {
  word: string;
  sentence?: string | null;
  level?: string | null;
  pos?: string | null;
}

/**
 * Fixed dark ground rather than the active theme.
 *
 * The card leaves the app: it will be seen on someone else's feed next to
 * other people's posts, not inside our light or dark mode. One look means the
 * brand is recognisable and, practically, that a light-mode user does not post
 * a white rectangle that vanishes into an Instagram story background.
 */
const INK = '#FFFFFF';
const INK_MUTED = 'rgba(255,255,255,0.62)';
const INK_FAINT = 'rgba(255,255,255,0.40)';
const BG_TOP = '#17151E';
const BG_BOTTOM = '#0B0A0E';
const ACCENT = '#FFD166';

export const ShareCard = forwardRef<Svg, ShareCardProps>(function ShareCard(
  { word, sentence, level, pos },
  ref,
) {
  const size = useMemo(() => wordFontSize(word), [word]);
  const lines = useMemo(
    () => (sentence ? wrapText(sentence, SENTENCE_SIZE) : []),
    [sentence],
  );
  const band = level && level in cefrColors ? level : null;

  // The word sits on the optical centre, with the sentence block hanging below
  // it. Computed rather than flexed because SVG has no layout — every y here
  // is an absolute coordinate on the canvas.
  const wordY = CARD_H * 0.46;
  const sentenceTop = wordY + 96;

  return (
    <Svg ref={ref} width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`}>
      <Defs>
        <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={BG_TOP} />
          <Stop offset="1" stopColor={BG_BOTTOM} />
        </LinearGradient>
        <LinearGradient id="glow" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor={ACCENT} stopOpacity="0.16" />
          <Stop offset="1" stopColor={ACCENT} stopOpacity="0" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width={CARD_W} height={CARD_H} fill="url(#ground)" />
      {/* The same warm vignette every screen in the app wears, so a posted
          card is recognisably from here even without the wordmark. */}
      <Rect x="0" y="0" width={CARD_W} height={CARD_H * 0.5} fill="url(#glow)" />

      {/* Wordmark, top-left. */}
      <SvgText
        x={PADDING}
        y={PADDING + 28}
        fill={ACCENT}
        fontSize={30}
        fontWeight="800"
        fontFamily={MONO_FAMILY}
        letterSpacing="6"
      >
        WORDWISE
      </SvgText>

      {/* CEFR band and part of speech, as one quiet line above the word. */}
      {band || pos ? (
        <SvgText
          x={PADDING}
          y={wordY - size - 18}
          fill={band ? cefrColors[band] : INK_FAINT}
          fontSize={30}
          fontWeight="800"
          fontFamily={MONO_FAMILY}
          letterSpacing="4"
        >
          {[band, pos ? pos.replace(/\.$/, '').toUpperCase() : null]
            .filter(Boolean)
            .join('   ')}
        </SvgText>
      ) : null}

      <SvgText
        x={PADDING}
        y={wordY}
        fill={INK}
        fontSize={size}
        fontWeight="600"
        fontFamily={SERIF_FAMILY}
      >
        {word}
      </SvgText>

      {/* Rule, then the sentence. Each line is placed by hand because SVG has
          no concept of a paragraph. */}
      {lines.length > 0 ? (
        <Rect x={PADDING} y={sentenceTop - 44} width={120} height={3} fill={ACCENT} opacity={0.5} />
      ) : null}
      {lines.map((line, i) => (
        <SvgText
          key={i}
          x={PADDING}
          y={sentenceTop + i * SENTENCE_LINE_H}
          fill={INK_MUTED}
          fontSize={SENTENCE_SIZE}
          fontStyle="italic"
          fontFamily={SERIF_ITALIC_FAMILY}
        >
          {line}
        </SvgText>
      ))}

      <SvgText
        x={PADDING}
        y={CARD_H - PADDING}
        fill={INK_FAINT}
        fontSize={26}
        fontWeight="700"
        fontFamily={MONO_FAMILY}
        letterSpacing="3"
      >
        getwordwise.us
      </SvgText>
    </Svg>
  );
});
