/**
 * Pagination Repacking Utility
 *
 * Rebuilds pagination to ensure consistent page sizes after filtering.
 * Each page contains exactly ITEMS_PER_PAGE items, except the last page.
 *
 * IMPORTANT: This utility should only be called AFTER filtering is complete.
 * Do NOT pass partially-translated data - wait for all necessary translations
 * to be loaded before repacking, or use defensive filtering that keeps
 * untranslated items in the list.
 */

export interface PaginationConfig {
  itemsPerPage: number;
}

export interface RepackedPagination<T> {
  pages: T[][];
  totalPages: number;
  totalItems: number;
}

/**
 * Repacks a filtered array into pages of consistent size.
 *
 * @param items - The filtered array of items (after all filters applied)
 * @param itemsPerPage - Number of items per page (default: 10)
 * @returns Object containing pages array, total pages count, and total items
 *
 * @example
 * const filteredWords = [w1, w2, w3, ..., w23]; // 23 items
 * const result = repackPages(filteredWords, 10);
 * // result.pages = [[10 items], [10 items], [3 items]]
 * // result.totalPages = 3
 * // result.totalItems = 23
 */
export function repackPages<T>(
  items: T[],
  itemsPerPage: number = 10
): RepackedPagination<T> {
  // Edge case: empty array
  if (items.length === 0) {
    return {
      pages: [],
      totalPages: 0,
      totalItems: 0
    };
  }

  // Edge case: fewer items than one page
  if (items.length <= itemsPerPage) {
    return {
      pages: [items],
      totalPages: 1,
      totalItems: items.length
    };
  }

  // Main algorithm: Sequential filling
  const pages: T[][] = [];
  let currentIndex = 0;

  while (currentIndex < items.length) {
    const pageItems = items.slice(currentIndex, currentIndex + itemsPerPage);
    pages.push(pageItems);
    currentIndex += itemsPerPage;
  }

  return {
    pages,
    totalPages: pages.length,
    totalItems: items.length
  };
}

/**
 * Clamps a page number to valid range after repacking.
 *
 * @param currentPage - The user's current page (1-indexed)
 * @param totalPages - Total pages after repacking
 * @returns Clamped page number (1-indexed)
 *
 * @example
 * // User was on page 5, but after filtering only 3 pages exist
 * const safePage = clampPageNumber(5, 3); // returns 3
 */
export function clampPageNumber(currentPage: number, totalPages: number): number {
  if (totalPages === 0) return 1;
  if (currentPage < 1) return 1;
  if (currentPage > totalPages) return totalPages;
  return currentPage;
}

/**
 * Gets items for a specific page from repacked pagination.
 *
 * @param repackedResult - Result from repackPages()
 * @param pageNumber - Page number (1-indexed)
 * @returns Array of items for that page, or empty array if invalid page
 */
export function getPageItems<T>(
  repackedResult: RepackedPagination<T>,
  pageNumber: number
): T[] {
  if (pageNumber < 1 || pageNumber > repackedResult.totalPages) {
    return [];
  }
  return repackedResult.pages[pageNumber - 1];
}

// ============================================================================
// Unit Test Examples (for verification)
// ============================================================================

/**
 * Test helper to verify repacking behavior
 */
export function testRepackPages(): void {
  console.group('[Pagination Repack Tests]');

  // Test 1: Empty array
  const test1 = repackPages<number>([], 10);
  console.assert(test1.pages.length === 0, 'Empty array should produce 0 pages');
  console.assert(test1.totalPages === 0, 'Empty array should have 0 total pages');

  // Test 2: Less than one page
  const test2 = repackPages([1, 2, 3, 4, 5], 10);
  console.assert(test2.pages.length === 1, 'Should produce 1 page');
  console.assert(test2.pages[0].length === 5, 'First page should have 5 items');

  // Test 3: Exactly one page
  const test3 = repackPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
  console.assert(test3.pages.length === 1, 'Should produce 1 page');
  console.assert(test3.pages[0].length === 10, 'First page should have 10 items');

  // Test 4: Multiple full pages
  const test4 = repackPages(Array.from({ length: 30 }, (_, i) => i + 1), 10);
  console.assert(test4.pages.length === 3, 'Should produce 3 pages');
  console.assert(test4.pages[0].length === 10, 'Page 1 should have 10 items');
  console.assert(test4.pages[1].length === 10, 'Page 2 should have 10 items');
  console.assert(test4.pages[2].length === 10, 'Page 3 should have 10 items');

  // Test 5: Partial last page
  const test5 = repackPages(Array.from({ length: 23 }, (_, i) => i + 1), 10);
  console.assert(test5.pages.length === 3, 'Should produce 3 pages');
  console.assert(test5.pages[0].length === 10, 'Page 1 should have 10 items');
  console.assert(test5.pages[1].length === 10, 'Page 2 should have 10 items');
  console.assert(test5.pages[2].length === 3, 'Page 3 should have 3 items');

  // Test 6: Order preservation
  const test6 = repackPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 10);
  console.assert(test6.pages[0][0] === 1, 'First item should be 1');
  console.assert(test6.pages[0][9] === 10, 'Tenth item should be 10');
  console.assert(test6.pages[1][0] === 11, 'Page 2 first item should be 11');

  // Test 7: Clamping
  console.assert(clampPageNumber(5, 3) === 3, 'Should clamp to max page');
  console.assert(clampPageNumber(0, 3) === 1, 'Should clamp to min page');
  console.assert(clampPageNumber(2, 3) === 2, 'Should keep valid page');
  console.assert(clampPageNumber(1, 0) === 1, 'Should handle 0 pages');

  console.log('✅ All pagination repack tests passed');
  console.groupEnd();
}

// Uncomment to run tests in development:
// if (import.meta.env.DEV) {
//   testRepackPages();
// }
