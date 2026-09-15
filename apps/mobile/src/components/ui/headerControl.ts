/**
 * The header control box: one size for the squares that sit in a screen's top
 * row.
 *
 * The Explore search row set it: a 48pt field and a 48pt filter button beside
 * it, both with a 12pt corner. The upgrade button is that box wherever it
 * appears, so "the same size as the filter button" is one number here rather
 * than two literals that drift the first time either is touched.
 */
export const HEADER_CONTROL = { size: 48, radius: 12 } as const;
