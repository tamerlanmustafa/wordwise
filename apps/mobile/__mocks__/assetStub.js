/**
 * Stands in for any binary asset (`require('…/correct.wav')`) under jest.
 *
 * Metro resolves an asset require to a numeric handle the native side looks
 * up; jest has no such resolver and would try to parse the file as JavaScript.
 * A number is the honest stub — it is exactly what the real require returns to
 * the calling code, and nothing a test can assert goes deeper than that.
 */
module.exports = 1;
