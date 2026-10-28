/** IndexedDB key for the versioned project master copy. */
export const PROJECT_MANIFEST_KEY = 'project-manifest';

/** Legacy profile-only key used before project-level persistence. */
export const LEGACY_PROFILE_KEY = 'game-profile';

/** Prefix for legacy profile-scoped card libraries. */
export const CARD_LIBRARY_KEY_PREFIX = 'card-library:';

/** IndexedDB key for one profile's legacy card library. */
export function cardLibraryKey(profileId: string): string {
  return `${CARD_LIBRARY_KEY_PREFIX}${profileId}`;
}

/** Prefix for content-addressed artwork bytes. */
export const ASSET_KEY_PREFIX = 'asset:';

/** IndexedDB key for one content-addressed artwork payload. */
export function assetStorageKey(assetId: string): string {
  return `${ASSET_KEY_PREFIX}${assetId}`;
}
