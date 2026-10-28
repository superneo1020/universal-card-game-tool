/**
 * Generates a prefixed, stable local id.
 *
 * `crypto.randomUUID` is preferred; the fallback is only for non-secure
 * contexts where the Web Crypto UUID helper is unavailable. These ids are not
 * security tokens.
 */
export function createUniqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
