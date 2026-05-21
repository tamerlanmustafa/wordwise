/**
 * UnitPath — v0.7 Practice tab vertical zigzag of 5 lesson nodes.
 *
 * Layout: each lesson sits inside a 76×76 hit area, translated x by a
 * fixed offset from the `X_OFFSETS` table. Consecutive nodes are joined
 * by a `LessonConnector` line. The path renders inline in the screen's
 * vertical scroll — no absolute positioning — so it composes naturally
 * with the unit marquee above and the next unit below.
 */

import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import { LessonNode } from './LessonNode';
import { LessonConnector } from './LessonConnector';
import type { PracticeLesson, PracticeUnit } from '../../services/api';

/** Spec from `tabs/practice.jsx → X_OFFSETS`. Gentle zigzag, NOT the
 *  rejected film-reel scroll's full vertical sweep. */
const X_OFFSETS = [0, 56, 24, -32, -8];

export interface UnitPathProps {
  unit: PracticeUnit;
  onLessonPress?: (unit: PracticeUnit, lesson: PracticeLesson) => void;
}

export function UnitPath({ unit, onLessonPress }: UnitPathProps) {
  return (
    <View style={styles.wrap}>
      {unit.lessons.map((lesson, i) => {
        const x = X_OFFSETS[i % X_OFFSETS.length];
        const prevX = i > 0 ? X_OFFSETS[(i - 1) % X_OFFSETS.length] : null;
        const prevDone = i > 0 ? unit.lessons[i - 1].state === 'done' : false;
        return (
          <Fragment key={lesson.id}>
            {prevX != null ? (
              <LessonConnector prevOffset={prevX} currOffset={x} prevDone={prevDone} />
            ) : null}
            <View style={[styles.nodeRow, { transform: [{ translateX: x }] }]}>
              <LessonNode
                kind={lesson.kind}
                state={lesson.state}
                onPress={() => onLessonPress?.(unit, lesson)}
              />
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  nodeRow: {
    alignItems: 'center',
    paddingVertical: 14,
  },
});
