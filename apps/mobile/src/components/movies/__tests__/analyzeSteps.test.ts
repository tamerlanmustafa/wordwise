import { ANALYZE_STEPS, phaseToStep, isAnalyzeComplete, type AnalyzePhase } from '../analyzeSteps';

describe('analyzeSteps', () => {
  it('ships the four prototype stages in order', () => {
    expect(ANALYZE_STEPS).toEqual([
      'Fetching the subtitles',
      'Matching the dictionary',
      'Ranking words by frequency',
      'Tagging CEFR levels',
    ]);
  });

  describe('phaseToStep', () => {
    it('maps each phase to its checklist index', () => {
      expect(phaseToStep('fetching')).toBe(0);
      expect(phaseToStep('matching')).toBe(1);
      expect(phaseToStep('ranking')).toBe(2);
      expect(phaseToStep('tagging')).toBe(3);
    });

    it("'done' marks every step complete (index === length)", () => {
      expect(phaseToStep('done')).toBe(ANALYZE_STEPS.length);
    });

    it('never returns an index past the checklist length', () => {
      (['fetching', 'matching', 'ranking', 'tagging', 'done'] as AnalyzePhase[]).forEach((p) => {
        expect(phaseToStep(p)).toBeLessThanOrEqual(ANALYZE_STEPS.length);
        expect(phaseToStep(p)).toBeGreaterThanOrEqual(0);
      });
    });

    it('is monotonic across the phase order', () => {
      const seq = (['fetching', 'matching', 'ranking', 'tagging', 'done'] as AnalyzePhase[]).map(phaseToStep);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).toBeGreaterThan(seq[i - 1]);
      }
    });

    it('falls back to step 0 for an unknown phase rather than crashing', () => {
      expect(phaseToStep('bogus' as AnalyzePhase)).toBe(0);
    });
  });

  describe('isAnalyzeComplete', () => {
    it('is true only for the done phase', () => {
      expect(isAnalyzeComplete('done')).toBe(true);
      expect(isAnalyzeComplete('tagging')).toBe(false);
      expect(isAnalyzeComplete('fetching')).toBe(false);
    });
  });
});
