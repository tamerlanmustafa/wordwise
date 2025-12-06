# Frontend Integration Guide - Movie Difficulty Display

This guide shows how to display movie difficulty ratings in the WordWise frontend.

---

## Component Library

### 1. DifficultyBadge Component

**Location**: `frontend/src/components/DifficultyBadge.tsx`

A reusable, customizable badge component with optional tooltip showing detailed breakdown.

**Usage Examples:**

```tsx
import { DifficultyBadge, DifficultyIndicator } from '../components/DifficultyBadge';

// Full badge with tooltip
<DifficultyBadge
  level="B2"
  score={3.52}
  breakdown={{ A1: 18, A2: 15, B1: 22, B2: 25, C1: 14, C2: 6 }}
  showTooltip={true}
  size="medium"
  variant="default"
/>

// Compact indicator for cards/lists
<DifficultyIndicator level="B1" />

// Large filled variant
<DifficultyBadge
  level="C1"
  size="large"
  variant="filled"
  showTooltip={false}
/>
```

**Props:**
- `level`: CEFR level (A1-C2) - **required**
- `score`: Difficulty score (0-6) - optional
- `breakdown`: Percentage distribution by level - optional
- `size`: Badge size ('small' | 'medium' | 'large') - default: 'medium'
- `showTooltip`: Show detailed breakdown on hover - default: true
- `variant`: Visual style ('default' | 'outlined' | 'filled') - default: 'default'

---

## Integration Points

### 1. Movie Detail Page

Add difficulty badge to the movie header:

```tsx
// frontend/src/pages/MovieDetailPage.tsx

import { DifficultyBadge } from '../components/DifficultyBadge';
import { useState, useEffect } from 'react';
import axios from 'axios';

function MovieDetailPage() {
  const [difficulty, setDifficulty] = useState(null);

  useEffect(() => {
    const fetchDifficulty = async () => {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await axios.get(`${API_BASE_URL}/movies/${movieId}/difficulty`);

        if (response.data.difficulty_level) {
          setDifficulty({
            level: response.data.difficulty_level,
            score: response.data.difficulty_score / 100 * 6, // Convert 0-100 to 0-6
            breakdown: JSON.parse(response.data.distribution || '{}')
          });
        }
      } catch (error) {
        console.error('Failed to fetch difficulty:', error);
      }
    };

    fetchDifficulty();
  }, [movieId]);

  return (
    <Box>
      {/* Movie Header */}
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h4">{movie.title}</Typography>

        {difficulty && (
          <DifficultyBadge
            level={difficulty.level}
            score={difficulty.score}
            breakdown={difficulty.breakdown}
            size="large"
            showTooltip={true}
          />
        )}
      </Stack>

      {/* Rest of page */}
    </Box>
  );
}
```

### 2. Movie Search Results / Card Grid

Add compact difficulty indicator to movie cards:

```tsx
// frontend/src/components/MovieCard.tsx

import { DifficultyIndicator } from './DifficultyBadge';

function MovieCard({ movie }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Typography variant="h6">{movie.title}</Typography>

          {movie.difficulty_level && (
            <DifficultyIndicator level={movie.difficulty_level} />
          )}
        </Stack>

        {/* Rest of card content */}
      </CardContent>
    </Card>
  );
}
```

### 3. Movie Recommendations

Show difficulty badges in recommendation lists:

```tsx
// frontend/src/pages/RecommendationsPage.tsx

<List>
  {recommendations.map(movie => (
    <ListItem key={movie.id}>
      <ListItemText
        primary={movie.title}
        secondary={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <DifficultyBadge
              level={movie.difficulty_level}
              size="small"
              showTooltip={false}
            />
            <Typography variant="caption" color="text.secondary">
              {getLevelDescription(movie.difficulty_level)}
            </Typography>
          </Stack>
        }
      />
    </ListItem>
  ))}
</List>
```

### 4. Difficulty Filter for Movie Search

Add difficulty level filter to search/browse:

```tsx
// frontend/src/components/DifficultyFilter.tsx

import { ToggleButtonGroup, ToggleButton } from '@mui/material';
import { getLevelColor, type CEFRLevel } from '../utils/computeMovieDifficulty';

const LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function DifficultyFilter({ value, onChange }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Filter by Difficulty:
      </Typography>

      <ToggleButtonGroup
        value={value}
        onChange={(_, newValue) => onChange(newValue)}
        aria-label="difficulty filter"
      >
        {LEVELS.map(level => (
          <ToggleButton
            key={level}
            value={level}
            sx={{
              '&.Mui-selected': {
                bgcolor: getLevelColor(level),
                color: '#fff',
                '&:hover': {
                  bgcolor: getLevelColor(level),
                  opacity: 0.9
                }
              }
            }}
          >
            {level}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
```

---

## Visual Design Specs

### Color Gradient

```
A1 (Beginner)      → Green    #4caf50
A2 (Elementary)    → Lt Green #8bc34a
B1 (Intermediate)  → Yellow   #ffc107
B2 (Upper Int.)    → Orange   #ff9800
C1 (Advanced)      → Red      #f44336
C2 (Proficient)    → Purple   #9c27b0
```

### Badge Variants

**1. Default (Outlined)**
- Light background with level color tint (15% opacity)
- Colored text and icon
- Best for: Inline text, cards

**2. Outlined**
- Transparent background
- 2px colored border
- Best for: Emphasis, hero sections

**3. Filled**
- Solid background in level color
- White text and icon
- Best for: High contrast, dark backgrounds

### Size Specifications

```
Small:  24px height, 0.75rem font
Medium: 32px height, 0.875rem font
Large:  40px height, 1rem font
```

---

## Tooltip Breakdown Design

The tooltip shows:

1. **Header**: Level + Description
2. **Difficulty Score**: Numeric score (0-6)
3. **Grouped Breakdown**:
   - ✅ Basic/Elementary (A1+A2)
   - ⚠️ Intermediate (B1+B2)
   - 🔴 Advanced/Proficient (C1+C2)
4. **Progress Bars**: Visual percentage representation
5. **Individual Levels**: Detailed A1-C2 percentages
6. **Recommendation**: Learning level guidance

**Example Tooltip HTML**:
```
┌─────────────────────────────────────┐
│ Difficulty: B2 - Upper Intermediate │
│ Difficulty Score: 3.52              │
│                                     │
│ ⚠️ Basic/Elementary        33%      │
│ ████████░░░░░░░░░░░░░░░░░░          │
│   ● A1: 18%  ● A2: 15%              │
│                                     │
│ ✅ Intermediate            22%      │
│ ██████░░░░░░░░░░░░░░░░░░░░          │
│   ● B1: 22%  ● B2: 0%               │
│                                     │
│ 🔴 Advanced/Proficient     20%      │
│ █████░░░░░░░░░░░░░░░░░░░░░          │
│   ● C1: 14%  ● C2: 6%               │
│                                     │
│ ─────────────────────────────────   │
│ 📚 Recommended For:                 │
│ Upper intermediate learners ready   │
│ for complex content                 │
└─────────────────────────────────────┘
```

---

## API Integration

### Fetch Difficulty Data

```typescript
// frontend/src/services/difficultyService.ts

import apiClient from './api';

export interface MovieDifficulty {
  difficulty_level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  difficulty_score: number;
  distribution: string; // JSON string
}

export async function getMovieDifficulty(movieId: number): Promise<MovieDifficulty | null> {
  try {
    const response = await apiClient.get(`/movies/${movieId}/difficulty`);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch movie difficulty:', error);
    return null;
  }
}

export function parseDifficultyBreakdown(distribution: string) {
  try {
    return JSON.parse(distribution);
  } catch {
    return {};
  }
}
```

### Usage in Components

```typescript
import { getMovieDifficulty, parseDifficultyBreakdown } from '../services/difficultyService';

const [difficulty, setDifficulty] = useState(null);

useEffect(() => {
  const loadDifficulty = async () => {
    const data = await getMovieDifficulty(movieId);
    if (data && data.difficulty_level) {
      setDifficulty({
        level: data.difficulty_level,
        score: (data.difficulty_score / 100) * 6, // Normalize to 0-6
        breakdown: parseDifficultyBreakdown(data.distribution)
      });
    }
  };

  loadDifficulty();
}, [movieId]);
```

---

## Responsive Design

### Mobile (< 600px)
- Use `size="small"` for badges
- Hide tooltip on mobile, show breakdown on tap
- Stack difficulty badge below title

### Tablet (600px - 960px)
- Use `size="medium"` for badges
- Tooltip enabled
- Inline with title

### Desktop (> 960px)
- Use `size="large"` in hero sections
- Full tooltip with all details
- Inline or side-by-side layouts

```tsx
// Responsive example
import { useMediaQuery, useTheme } from '@mui/material';

function ResponsiveDifficultyBadge({ level, score, breakdown }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));

  const size = isMobile ? 'small' : isTablet ? 'medium' : 'large';
  const showTooltip = !isMobile;

  return (
    <DifficultyBadge
      level={level}
      score={score}
      breakdown={breakdown}
      size={size}
      showTooltip={showTooltip}
    />
  );
}
```

---

## Accessibility

### ARIA Labels
```tsx
<Chip
  aria-label={`Difficulty level ${level}: ${getLevelDescription(level)}`}
  role="status"
  {...props}
/>
```

### Keyboard Navigation
- Tooltip accessible via keyboard focus
- Tab navigation support
- Enter/Space to expand tooltip on mobile

### Screen Reader Support
```tsx
<Box role="tooltip" aria-live="polite">
  <VisuallyHidden>
    This movie is rated {level} difficulty, suitable for {getLevelDescription(level)}
  </VisuallyHidden>
  {/* Visual content */}
</Box>
```

---

## Testing Integration

```tsx
// DifficultyBadge.test.tsx

import { render, screen } from '@testing-library/react';
import { DifficultyBadge } from './DifficultyBadge';

test('renders difficulty badge with level', () => {
  render(<DifficultyBadge level="B2" />);
  expect(screen.getByText('B2')).toBeInTheDocument();
});

test('shows tooltip on hover', async () => {
  render(
    <DifficultyBadge
      level="B2"
      showTooltip
      breakdown={{ A1: 18, A2: 15, B1: 22, B2: 25, C1: 14, C2: 6 }}
    />
  );

  // Hover over badge
  fireEvent.mouseOver(screen.getByText('B2'));

  // Tooltip should appear
  await waitFor(() => {
    expect(screen.getByText(/Upper Intermediate/i)).toBeVisible();
  });
});
```

---

## Performance Optimization

### 1. Lazy Load Difficulty Data
```tsx
// Only fetch when user hovers/clicks
const [difficultyData, setDifficultyData] = useState(null);
const [isHovering, setIsHovering] = useState(false);

useEffect(() => {
  if (isHovering && !difficultyData) {
    fetchDifficulty();
  }
}, [isHovering]);
```

### 2. Memoize Breakdown Parsing
```tsx
const breakdown = useMemo(
  () => parseDifficultyBreakdown(movie.distribution),
  [movie.distribution]
);
```

### 3. Cache Difficulty Data
```tsx
// Use React Query or SWR for caching
const { data: difficulty } = useQuery(
  ['difficulty', movieId],
  () => getMovieDifficulty(movieId),
  { staleTime: 1000 * 60 * 60 } // Cache for 1 hour
);
```

---

## Next Steps

1. ✅ Install DifficultyBadge component
2. ✅ Add to MovieDetailPage
3. ✅ Add to MovieCard components
4. ✅ Add difficulty filter to search
5. ✅ Test on mobile devices
6. ✅ Add analytics tracking for difficulty interactions
7. ✅ Gather user feedback on difficulty accuracy
