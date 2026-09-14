/**
 * apiError — turning a FastAPI error body into a sentence a person can read.
 *
 * ## The bug this exists to prevent
 *
 * FastAPI answers a *validation* failure with `detail` as an **array of
 * objects**, and everything else with `detail` as a string:
 *
 *   422 → {"detail": [{"type": "value_error", "loc": ["body","email"],
 *                      "msg": "value is not a valid email address: …"}]}
 *   400 → {"detail": "Username already taken"}
 *
 * Every call site in this app assumed the second shape — `new Error(detail)`,
 * `String(body.detail)` — so the first rendered as the literal text
 * `[object Object]`. Observed on the login screen, which is the worst possible
 * place for it: 422 is exactly what the two commonest signup mistakes produce.
 *
 *   an email with no "@"        → [object Object]
 *   a password under 8 chars    → [object Object]
 *
 * The server sends a perfectly good sentence in `msg` and the client threw it
 * away. This reads it.
 *
 * ## Why a helper rather than a fix at each call site
 *
 * There were four independent `String(detail)` sites and each would have been
 * fixed the same way. The shape of an error body is a property of the API, not
 * of the screen asking — so it is read in one place, and a new endpoint gets
 * the behaviour without anyone remembering.
 */

/** One entry of FastAPI's 422 body. Only `msg` is load-bearing here. */
interface ValidationItem {
  msg?: unknown;
  loc?: unknown;
}

function isValidationItem(v: unknown): v is ValidationItem {
  return typeof v === 'object' && v !== null && 'msg' in v;
}

/**
 * Pydantic prefixes its own messages with "Value error, ". That is an
 * implementation detail of the validator, not something to show a person.
 */
function clean(msg: string): string {
  return msg.replace(/^value error,\s*/i, '').trim();
}

/**
 * Read the human-readable reason out of an error body, whatever shape it took.
 *
 * Returns `null` rather than a fallback string when there is nothing useful to
 * say, so the caller supplies copy in the user's own language — a generic
 * message belongs in the locale files, not in here.
 */
export function readApiError(body: unknown): string | null {
  if (body == null) return null;

  // A bare string body (some proxies) or an already-extracted detail.
  if (typeof body === 'string') return body.trim() || null;

  const detail = (body as { detail?: unknown }).detail ?? body;

  if (typeof detail === 'string') return detail.trim() || null;

  if (Array.isArray(detail)) {
    const messages = detail
      .filter(isValidationItem)
      .map((item) => (typeof item.msg === 'string' ? clean(item.msg) : ''))
      .filter(Boolean);
    if (messages.length === 0) return null;
    // Joined rather than first-only: submitting a form with two bad fields and
    // being told about one, fixing it, then being told about the other is the
    // interaction that makes a signup feel broken.
    return messages.join('\n');
  }

  // An object that is not an array — e.g. the paywall's structured detail.
  // `message` is the only key any of ours uses for prose.
  if (typeof detail === 'object' && detail !== null) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }

  return null;
}

/**
 * Read an error out of a `Response` that has already been found not-ok.
 *
 * Swallows a body that is not JSON at all (an HTML 502 from a proxy, an empty
 * 500), because a JSON parse error is not something the user can act on.
 */
export async function readResponseError(res: Response): Promise<string | null> {
  try {
    return readApiError(await res.json());
  } catch {
    return null;
  }
}
