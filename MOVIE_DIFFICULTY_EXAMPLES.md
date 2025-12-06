# Movie Difficulty Engine - Example Outputs

This document shows example outputs from the WordWise Movie Difficulty Rating Engine for three hypothetical movies.

## Example 1: Harry Potter and the Sorcerer's Stone

### Input Data
```typescript
const cefrBreakdown = {
  A1: 35,  // High proportion of basic words
  A2: 25,
  B1: 20,
  B2: 12,
  C1: 6,
  C2: 2
};

const sampleWords = [
  { word: 'the', count: 1250, cefr: 'A1', confidenceLevel: 0.99, frequencyRank: 1 },
  { word: 'wand', count: 180, cefr: 'A2', confidenceLevel: 0.92, frequencyRank: 3500 },
  { word: 'magic', count: 165, cefr: 'A2', confidenceLevel: 0.95, frequencyRank: 2800 },
  { word: 'discover', count: 95, cefr: 'B1', confidenceLevel: 0.88, frequencyRank: 4200 },
  { word: 'mysterious', count: 55, cefr: 'B2', confidenceLevel: 0.85, frequencyRank: 7500 },
  { word: 'sorcerer', count: 42, cefr: 'C1', confidenceLevel: 0.78, frequencyRank: 15000 },
  // ... more words
];
```

### Output
```json
{
  "difficultyLevel": "A2",
  "difficultyScore": 2.15,
  "breakdown": {
    "A1": 35,
    "A2": 25,
    "B1": 20,
    "B2": 12,
    "C1": 6,
    "C2": 2
  },
  "rarityAdjustment": 0,
  "metadata": {
    "averageConfidence": 0.91,
    "averageFrequencyRank": 5840,
    "totalWords": 85420,
    "uniqueWords": 3850
  }
}
```

### User-Facing Display
**"Harry Potter and the Sorcerer's Stone → Recommended for A2 (Elementary) learners and above"**

**Breakdown Tooltip:**
- ✅ 35% Basic words (A1)
- ✅ 25% Elementary words (A2)
- ⚠️ 20% Intermediate words (B1)
- ⚠️ 12% Upper intermediate (B2)
- 🔸 8% Advanced/Proficient (C1-C2)

---

## Example 2: Interstellar

### Input Data
```typescript
const cefrBreakdown = {
  A1: 18,
  A2: 15,
  B1: 22,
  B2: 25,  // High proportion of complex vocabulary
  C1: 14,
  C2: 6
};

const sampleWords = [
  { word: 'the', count: 1850, cefr: 'A1', confidenceLevel: 0.99, frequencyRank: 1 },
  { word: 'gravity', count: 120, cefr: 'B1', confidenceLevel: 0.90, frequencyRank: 8500 },
  { word: 'dimension', count: 95, cefr: 'B2', confidenceLevel: 0.87, frequencyRank: 9200 },
  { word: 'relativity', count: 48, cefr: 'C1', confidenceLevel: 0.82, frequencyRank: 18000 },
  { word: 'quantum', count: 42, cefr: 'C1', confidenceLevel: 0.80, frequencyRank: 16500 },
  { word: 'singularity', count: 28, cefr: 'C2', confidenceLevel: 0.75, frequencyRank: 25000 },
  { word: 'tesseract', count: 18, cefr: 'C2', confidenceLevel: 0.70, frequencyRank: 35000 },
  // ... more words
];
```

### Output
```json
{
  "difficultyLevel": "B2",
  "difficultyScore": 3.52,
  "breakdown": {
    "A1": 18,
    "A2": 15,
    "B1": 22,
    "B2": 25,
    "C1": 14,
    "C2": 6
  },
  "rarityAdjustment": 0.1,
  "metadata": {
    "averageConfidence": 0.84,
    "averageFrequencyRank": 11850,
    "totalWords": 96300,
    "uniqueWords": 5240
  }
}
```

### User-Facing Display
**"Interstellar → Recommended for B2 (Upper Intermediate) learners and above"**

**Breakdown Tooltip:**
- ⚠️ 33% Basic/Elementary (A1-A2)
- ✅ 22% Intermediate (B1)
- ✅ 25% Upper Intermediate (B2)
- 🔴 20% Advanced/Proficient (C1-C2)
- 🔸 Rarity boost: +0.1 (contains rare scientific terms)

---

## Example 3: The Big Short

### Input Data
```typescript
const cefrBreakdown = {
  A1: 15,
  A2: 12,
  B1: 18,
  B2: 28,  // Heavy financial/technical vocabulary
  C1: 18,
  C2: 9
};

const sampleWords = [
  { word: 'the', count: 2100, cefr: 'A1', confidenceLevel: 0.99, frequencyRank: 1 },
  { word: 'money', count: 185, cefr: 'A2', confidenceLevel: 0.96, frequencyRank: 850 },
  { word: 'investment', count: 142, cefr: 'B2', confidenceLevel: 0.88, frequencyRank: 5800 },
  { word: 'subprime', count: 98, cefr: 'C1', confidenceLevel: 0.81, frequencyRank: 22000 },
  { word: 'derivative', count: 76, cefr: 'C1', confidenceLevel: 0.79, frequencyRank: 19500 },
  { word: 'collateralized', count: 52, cefr: 'C2', confidenceLevel: 0.72, frequencyRank: 28000 },
  { word: 'tranche', count: 38, cefr: 'C2', confidenceLevel: 0.68, frequencyRank: 32000 },
  // ... more words
];
```

### Output
```json
{
  "difficultyLevel": "C1",
  "difficultyScore": 4.08,
  "breakdown": {
    "A1": 15,
    "A2": 12,
    "B1": 18,
    "B2": 28,
    "C1": 18,
    "C2": 9
  },
  "rarityAdjustment": 0.1,
  "metadata": {
    "averageConfidence": 0.82,
    "averageFrequencyRank": 14250,
    "totalWords": 92150,
    "uniqueWords": 6180
  }
}
```

### User-Facing Display
**"The Big Short → Recommended for C1 (Advanced) learners and above"**

**Breakdown Tooltip:**
- ⚠️ 27% Basic/Elementary (A1-A2)
- ⚠️ 18% Intermediate (B1)
- ✅ 28% Upper Intermediate (B2)
- 🔴 27% Advanced/Proficient (C1-C2)
- 🔸 Rarity boost: +0.1 (contains specialized financial jargon)

---

## Score Distribution Chart

| Movie | Difficulty Score | CEFR Level | Primary Audience |
|-------|-----------------|------------|------------------|
| Harry Potter 1 | 2.15 | A2 | Elementary learners |
| Interstellar | 3.52 | B2 | Upper intermediate learners |
| The Big Short | 4.08 | C1 | Advanced learners |

---

## Interpretation Notes

### Rarity Adjustment Impact
- **Harry Potter**: Average frequency rank ~5,800 → No adjustment (middle range)
- **Interstellar**: Average frequency rank ~11,850 → +0.1 (rare scientific terms)
- **The Big Short**: Average frequency rank ~14,250 → +0.1 (specialized financial vocabulary)

### Confidence Weighting Impact
- **High confidence (0.90+)**: Strong CEFR classification, full weight applied
- **Medium confidence (0.70-0.89)**: Moderate certainty, proportionally reduced weight
- **Low confidence (<0.70)**: Uncertain classification, minimal contribution to score

### Why These Results Make Sense

**Harry Potter (A2):**
- Fantasy setting introduces some unique vocabulary ("wand", "spell")
- Overall narrative is accessible with simple sentence structures
- Perfect for elementary learners transitioning to longer texts

**Interstellar (B2):**
- Scientific concepts require intermediate+ vocabulary
- Mix of everyday dialogue and technical explanations
- Rare words like "tesseract", "singularity" push difficulty higher

**The Big Short (C1):**
- Heavily specialized financial terminology
- Abstract economic concepts require advanced comprehension
- Domain-specific jargon (CDO, tranche, subprime) is C1/C2 level
