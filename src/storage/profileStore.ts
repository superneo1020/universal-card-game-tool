import type { GameProfile } from '../types/Game';
import type { ValidationIssue } from '../utils/validation';
import { validateGameProfile } from '../utils/validation';
import {
  deleteStoredValue,
  readStoredValue,
  toErrorMessage,
  writeStoredValue,
} from './database';
import { LEGACY_PROFILE_KEY } from './keys';

const PROFILE_KEY = LEGACY_PROFILE_KEY;

/** Outcome of reading the saved profile from IndexedDB. */
export type StoredProfileLoadResult =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loaded'; readonly profile: GameProfile }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Loads and validates the saved game profile.
 *
 * Stored data is treated as untrusted: it may have been written by an older
 * build or edited through devtools. Invalid records are reported with issue
 * details instead of being used to hydrate state.
 */
export async function loadStoredGameProfile(): Promise<StoredProfileLoadResult> {
  try {
    const raw = await readStoredValue(PROFILE_KEY);

    if (raw === undefined) {
      return { kind: 'empty' };
    }

    const validation = validateGameProfile(raw);
    if (!validation.ok) {
      return { kind: 'invalid', issues: validation.issues };
    }

    return { kind: 'loaded', profile: validation.value };
  } catch (error) {
    return { kind: 'error', message: toErrorMessage(error) };
  }
}

/** Validates and persists the profile as a single atomic IndexedDB write. */
export async function saveStoredGameProfile(profile: GameProfile): Promise<void> {
  const validation = validateGameProfile(profile);

  if (!validation.ok) {
    throw new Error(
      `Refusing to persist an invalid game profile (${validation.issues.length} validation issue(s)).`,
    );
  }

  await writeStoredValue(PROFILE_KEY, validation.value);
}

/** Removes the saved profile without touching any other local data. */
export async function clearStoredGameProfile(): Promise<void> {
  await deleteStoredValue(PROFILE_KEY);
}
