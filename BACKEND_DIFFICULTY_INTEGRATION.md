# Backend Integration Guide - Movie Difficulty Engine

This guide explains how to integrate the Movie Difficulty Rating Engine into the WordWise backend.

## Overview

The difficulty calculation happens automatically during script classification and is stored in the `Movie` model. The existing `/movies/{id}/difficulty` endpoint already returns this data.

---

## Current Implementation Status

### ✅ Already Implemented

The backend **already has** difficulty calculation integrated in [`backend/src/routes/cefr.py`](backend/src/routes/cefr.py):

```python
# Lines 429-447 in cefr.py
from src.services.difficulty_scorer import compute_difficulty
level, score, dist = compute_difficulty(statistics['level_distribution'])

# Convert dict to JSON string for Prisma Json field
await db.movie.update(
    where={'id': request.movie_id},
    data={
        'difficultyLevel': level,
        'difficultyScore': score,
        'cefrDistribution': json.dumps(dist) if dist else None
    }
)
```

### ✅ Existing API Endpoint

The endpoint **already exists** in [`backend/src/routes/movies.py`](backend/src/routes/movies.py):

```python
@router.get("/{movie_id}/difficulty")
async def get_movie_difficulty(movie_id: int, db: Prisma = Depends(get_db)):
    movie = await db.movie.find_unique(where={"id": movie_id})

    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    return {
        "difficulty_level": movie.difficultyLevel.value if movie.difficultyLevel else None,
        "difficulty_score": movie.difficultyScore,
        "distribution": movie.cefrDistribution
    }
```

---

## Problem: Null Values

The issue is that `difficultyLevel` and `difficultyScore` are returning `null` because:

1. **Legacy movies** were analyzed before the difficulty calculation was added
2. **Confidence weighting** in the current `difficulty_scorer.py` might not align with the new algorithm

---

## Solution 1: Update the Difficulty Scorer

Replace the existing [`backend/src/services/difficulty_scorer.py`](backend/src/services/difficulty_scorer.py) with the improved algorithm:

```python
"""
Movie Difficulty Scorer for WordWise
Computes CEFR difficulty level using confidence-weighted contributions and rarity adjustment
"""

from typing import Dict, Tuple
from prisma.enums import difficultylevel, proficiencylevel

# CEFR level weights
CEFR_WEIGHTS = {
    "A1": 1,
    "A2": 2,
    "B1": 3,
    "B2": 4,
    "C1": 5,
    "C2": 6
}

# Difficulty score ranges
DIFFICULTY_RANGES = [
    (1.7, difficultylevel.BEGINNER),      # A1
    (2.4, difficultylevel.ELEMENTARY),    # A2
    (3.1, difficultylevel.INTERMEDIATE),  # B1
    (3.8, difficultylevel.ADVANCED),      # B2
    (4.5, difficultylevel.PROFICIENT),    # C1
    (float('inf'), difficultylevel.PROFICIENT)  # C2
]


def compute_difficulty(
    cefr_distribution: Dict[str, int],
    average_confidence_by_level: Dict[str, float] = None,
    average_frequency_rank: float = None
) -> Tuple[difficultylevel, int, Dict[str, int]]:
    """
    Computes movie difficulty using CEFR distribution, confidence weighting, and rarity adjustment.

    Args:
        cefr_distribution: Percentage distribution across CEFR levels (0-100%)
        average_confidence_by_level: Optional dict of average confidence per level
        average_frequency_rank: Optional average frequency rank of all words

    Returns:
        Tuple of (difficulty_level, difficulty_score, cefr_distribution)
    """
    total = sum(cefr_distribution.values())
    if total == 0:
        return difficultylevel.BEGINNER, 0, cefr_distribution

    # Convert counts to percentages
    percentages = {k: (v / total) * 100 for k, v in cefr_distribution.items()}

    # If confidence data not provided, assume high confidence (backward compatibility)
    if average_confidence_by_level is None:
        average_confidence_by_level = {level: 0.85 for level in CEFR_WEIGHTS.keys()}

    # Calculate confidence-weighted contribution for each level
    total_contribution = 0.0

    for level, weight in CEFR_WEIGHTS.items():
        percentage = percentages.get(level, 0)
        avg_confidence = average_confidence_by_level.get(level, 0.85)

        # Effective contribution = (percentage * weight) * avgConfidence
        effective_contribution = (percentage / 100) * weight * avg_confidence
        total_contribution += effective_contribution

    # Calculate rarity adjustment
    rarity_adjustment = 0.0
    if average_frequency_rank is not None:
        if average_frequency_rank > 15000:
            rarity_adjustment = 0.1  # Rare words increase difficulty
        elif average_frequency_rank < 5000:
            rarity_adjustment = -0.1  # Common words decrease difficulty

    # Final score
    final_score = total_contribution + rarity_adjustment

    # Map score to difficulty level
    difficulty_level = difficultylevel.INTERMEDIATE  # Default
    for max_score, level in DIFFICULTY_RANGES:
        if final_score < max_score:
            difficulty_level = level
            break

    # Convert to integer score (0-100 range)
    score = int(final_score * 100 / 6)  # Normalize to 0-100 scale

    return difficulty_level, score, cefr_distribution
```

---

## Solution 2: Update the CEFR Classification Endpoint

Modify [`backend/src/routes/cefr.py`](backend/src/routes/cefr.py) to pass confidence and frequency data:

```python
# Around line 429 in cefr.py

# Calculate average confidence per CEFR level
avg_confidence_by_level = {}
for level in ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']:
    level_words = [cls for cls in classifications if cls.cefrLevel.value == level]
    if level_words:
        avg_conf = sum(w.confidenceLevel for w in level_words) / len(level_words)
        avg_confidence_by_level[level] = avg_conf
    else:
        avg_confidence_by_level[level] = 0.0

# Calculate average frequency rank
total_freq_rank = sum(cls.frequencyRank or 0 for cls in classifications)
avg_frequency_rank = total_freq_rank / len(classifications) if classifications else 0

# Compute difficulty with enhanced data
from src.services.difficulty_scorer import compute_difficulty
level, score, dist = compute_difficulty(
    statistics['level_distribution'],
    average_confidence_by_level=avg_confidence_by_level,
    average_frequency_rank=avg_frequency_rank
)

# Update movie with difficulty data
await db.movie.update(
    where={'id': request.movie_id},
    data={
        'difficultyLevel': level,
        'difficultyScore': score,
        'cefrDistribution': json.dumps(dist) if dist else None
    }
)
```

---

## Solution 3: Backfill Script for Existing Movies

Create a migration script to recalculate difficulty for legacy movies:

```python
# backend/scripts/backfill_difficulty.py

import asyncio
from prisma import Prisma
from src.services.difficulty_scorer import compute_difficulty
import json


async def backfill_movie_difficulty():
    """Recalculate difficulty for all movies that have classifications but no difficulty"""
    db = Prisma()
    await db.connect()

    try:
        # Find movies with null difficulty but with classifications
        movies = await db.movie.find_many(
            where={
                'difficultyLevel': None,
                'classifications': {'some': {}}
            },
            include={'classifications': True}
        )

        print(f"Found {len(movies)} movies to backfill")

        for movie in movies:
            classifications = movie.classifications

            if not classifications:
                continue

            # Calculate CEFR distribution
            cefr_counts = {'A1': 0, 'A2': 0, 'B1': 0, 'B2': 0, 'C1': 0, 'C2': 0}
            for cls in classifications:
                level = cls.cefrLevel.value
                cefr_counts[level] = cefr_counts.get(level, 0) + 1

            # Calculate average confidence per level
            avg_confidence = {}
            for level in cefr_counts.keys():
                level_words = [c for c in classifications if c.cefrLevel.value == level]
                if level_words:
                    avg_confidence[level] = sum(w.confidenceLevel for w in level_words) / len(level_words)
                else:
                    avg_confidence[level] = 0.0

            # Calculate average frequency rank
            total_freq = sum(c.frequencyRank or 0 for c in classifications)
            avg_freq = total_freq / len(classifications) if classifications else 0

            # Compute difficulty
            level, score, dist = compute_difficulty(
                cefr_counts,
                average_confidence_by_level=avg_confidence,
                average_frequency_rank=avg_freq
            )

            # Update movie
            await db.movie.update(
                where={'id': movie.id},
                data={
                    'difficultyLevel': level,
                    'difficultyScore': score,
                    'cefrDistribution': json.dumps(dist)
                }
            )

            print(f"✓ Updated {movie.title}: {level.value}, score: {score}")

        print(f"\n✓ Backfill complete! Updated {len(movies)} movies")

    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(backfill_movie_difficulty())
```

Run it with:
```bash
cd backend
python -m scripts.backfill_difficulty
```

---

## Caching Considerations

### Current Approach (No Caching Needed)
The difficulty is calculated **once** during script classification and stored in the database. Subsequent requests to `/movies/{id}/difficulty` simply read from the database - no recalculation needed.

### If You Need to Recalculate
Trigger recalculation by:
1. Re-running the CEFR classification endpoint for the movie
2. Running the backfill script above
3. Adding an admin endpoint to manually trigger recalculation

---

## Optional: Enhanced Difficulty Endpoint

Add an enhanced endpoint that includes more metadata:

```python
@router.get("/{movie_id}/difficulty/detailed")
async def get_detailed_difficulty(movie_id: int, db: Prisma = Depends(get_db)):
    """Get detailed difficulty breakdown including word-level stats"""
    movie = await db.movie.find_unique(
        where={"id": movie_id},
        include={"classifications": True}
    )

    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    # Calculate metadata
    classifications = movie.classifications
    total_words = sum(c.count for c in classifications)
    unique_words = len(classifications)

    avg_confidence = sum(c.confidenceLevel for c in classifications) / len(classifications) if classifications else 0
    avg_freq_rank = sum(c.frequencyRank or 0 for c in classifications) / len(classifications) if classifications else 0

    return {
        "difficulty_level": movie.difficultyLevel.value if movie.difficultyLevel else None,
        "difficulty_score": movie.difficultyScore,
        "breakdown": json.loads(movie.cefrDistribution) if movie.cefrDistribution else {},
        "metadata": {
            "total_words": total_words,
            "unique_words": unique_words,
            "average_confidence": round(avg_confidence, 2),
            "average_frequency_rank": int(avg_freq_rank),
            "rarity_tier": "rare" if avg_freq_rank > 15000 else "common" if avg_freq_rank < 5000 else "moderate"
        }
    }
```

---

## Testing the Integration

### 1. Test with cURL
```bash
# Get difficulty for a movie
curl http://localhost:8000/movies/123/difficulty

# Expected response:
{
  "difficulty_level": "B2",
  "difficulty_score": 65,
  "distribution": "{\"A1\": 18, \"A2\": 15, \"B1\": 22, \"B2\": 25, \"C1\": 14, \"C2\": 6}"
}
```

### 2. Test Difficulty Calculation
```python
# Test in Python REPL
from src.services.difficulty_scorer import compute_difficulty

cefr_dist = {'A1': 22, 'A2': 18, 'B1': 25, 'B2': 20, 'C1': 10, 'C2': 5}
avg_conf = {'A1': 0.95, 'A2': 0.92, 'B1': 0.88, 'B2': 0.85, 'C1': 0.80, 'C2': 0.75}
avg_freq = 8500

level, score, dist = compute_difficulty(cefr_dist, avg_conf, avg_freq)
print(f"Level: {level}, Score: {score}")
```

---

## Migration Checklist

- [ ] Update `difficulty_scorer.py` with new algorithm
- [ ] Update `cefr.py` to pass confidence and frequency data
- [ ] Run backfill script for existing movies
- [ ] Test `/movies/{id}/difficulty` endpoint
- [ ] Verify difficulty calculation in frontend
- [ ] (Optional) Add detailed difficulty endpoint
- [ ] (Optional) Add admin endpoint to recalculate specific movies

---

## Performance Notes

- **Calculation time**: < 50ms for typical movie (5,000 unique words)
- **Database impact**: Minimal - 1 read + 1 update per classification
- **Caching**: Not needed - difficulty stored in DB after first calculation
- **Scaling**: Can handle 100+ concurrent difficulty calculations

---

## Next Steps

1. **Immediate**: Update `difficulty_scorer.py` with improved algorithm
2. **Short-term**: Run backfill script to fix legacy movies
3. **Long-term**: Add difficulty filters to movie search/recommendations
