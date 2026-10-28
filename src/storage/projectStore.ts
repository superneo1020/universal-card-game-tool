import { loadStoredCardLibrary } from './cardStore';
import {
  deleteStoredValue,
  readStoredKeys,
  readStoredValue,
  toErrorMessage,
  writeStoredValue,
  writeStoredValueAndDeleteKeys,
} from './database';
import {
  ASSET_KEY_PREFIX,
  CARD_LIBRARY_KEY_PREFIX,
  LEGACY_PROFILE_KEY,
  PROJECT_MANIFEST_KEY,
  cardLibraryKey,
} from './keys';
import { loadStoredGameProfile } from './profileStore';
import {
  createProjectManifest,
  validateStoredProject,
} from '../project/projectModel';
import type { ProjectManifest } from '../types/ProjectManifest';
import { CURRENT_SCHEMA_VERSION } from '../types/ProjectManifest';
import type { ValidationIssue } from '../utils/validation';

export type StoredProjectLoadResult =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'loaded';
      readonly project: ProjectManifest;
      readonly migratedFromLegacy: boolean;
    }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Storage operations used by the project store.
 *
 * The default implementation talks to IndexedDB; tests inject fakes to cover
 * migration failure paths without a browser.
 */
export interface ProjectStoreDependencies {
  readonly readValue: (key: string) => Promise<unknown>;
  readonly writeValue: (key: string, value: unknown) => Promise<void>;
  readonly writeValueAndDeleteKeys: (
    key: string,
    value: unknown,
    keysToDelete: readonly string[],
  ) => Promise<void>;
  readonly deleteValue: (key: string) => Promise<void>;
  readonly readKeys: () => Promise<string[]>;
  readonly loadLegacyProfile: typeof loadStoredGameProfile;
  readonly loadLegacyCardLibrary: typeof loadStoredCardLibrary;
}

const defaultProjectStoreDependencies: ProjectStoreDependencies = {
  readValue: readStoredValue,
  writeValue: writeStoredValue,
  writeValueAndDeleteKeys: writeStoredValueAndDeleteKeys,
  deleteValue: deleteStoredValue,
  readKeys: readStoredKeys,
  loadLegacyProfile: loadStoredGameProfile,
  loadLegacyCardLibrary: loadStoredCardLibrary,
};

async function migrateLegacyStores(
  dependencies: ProjectStoreDependencies,
): Promise<StoredProjectLoadResult> {
  const legacyProfile = await dependencies.loadLegacyProfile();

  if (legacyProfile.kind === 'empty') {
    return { kind: 'empty' };
  }

  if (legacyProfile.kind === 'invalid') {
    return { kind: 'invalid', issues: legacyProfile.issues };
  }

  if (legacyProfile.kind === 'error') {
    return { kind: 'error', message: legacyProfile.message };
  }

  const profile = legacyProfile.profile;
  const legacyCards = await dependencies.loadLegacyCardLibrary(profile.id);

  if (legacyCards.kind === 'invalid') {
    return { kind: 'invalid', issues: legacyCards.issues };
  }

  if (legacyCards.kind === 'error') {
    return { kind: 'error', message: legacyCards.message };
  }

  const baseProject = createProjectManifest(profile);
  const project =
    legacyCards.kind === 'loaded'
      ? { ...baseProject, cards: [...legacyCards.cards] }
      : baseProject;

  const validation = validateStoredProject(project);
  if (!validation.ok) {
    return { kind: 'invalid', issues: validation.issues };
  }

  // Write the manifest and remove the legacy keys in one transaction: a
  // failure rolls back both, so cleanup can never be silently skipped after a
  // successful migration.
  await dependencies.writeValueAndDeleteKeys(
    PROJECT_MANIFEST_KEY,
    validation.value,
    [LEGACY_PROFILE_KEY, cardLibraryKey(profile.id)],
  );

  return {
    kind: 'loaded',
    project: validation.value,
    migratedFromLegacy: true,
  };
}

/**
 * Upgrades the additive v1 -> v2 version marker without rewriting project data.
 * The full import migration pipeline is stricter than stored-project hydration,
 * so this local step preserves orphaned card values that must remain
 * recoverable.
 */
function migrateStoredManifestVersion(raw: unknown): {
  readonly value: unknown;
  readonly migrated: boolean;
} {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    'schemaVersion' in raw &&
    (raw as { schemaVersion?: unknown }).schemaVersion === 1
  ) {
    return {
      value: { ...raw, schemaVersion: CURRENT_SCHEMA_VERSION },
      migrated: true,
    };
  }

  return { value: raw, migrated: false };
}

/**
 * Loads the single project master copy, migrating legacy profile/card-library
 * records on first use.
 */
export async function loadStoredProject(
  dependencies: ProjectStoreDependencies = defaultProjectStoreDependencies,
): Promise<StoredProjectLoadResult> {
  try {
    const raw = await dependencies.readValue(PROJECT_MANIFEST_KEY);

    if (raw !== undefined) {
      const migration = migrateStoredManifestVersion(raw);
      const validation = validateStoredProject(migration.value);

      if (!validation.ok) {
        return { kind: 'invalid', issues: validation.issues };
      }

      if (migration.migrated) {
        await dependencies.writeValue(PROJECT_MANIFEST_KEY, validation.value);
      }

      return {
        kind: 'loaded',
        project: validation.value,
        migratedFromLegacy: false,
      };
    }

    return await migrateLegacyStores(dependencies);
  } catch (error) {
    return { kind: 'error', message: toErrorMessage(error) };
  }
}

/** Validates and persists the whole project as one atomic IndexedDB write. */
export async function saveStoredProject(
  project: ProjectManifest,
  dependencies: ProjectStoreDependencies = defaultProjectStoreDependencies,
): Promise<void> {
  const validation = validateStoredProject(project);

  if (!validation.ok) {
    throw new Error(
      `Refusing to persist an invalid project (${validation.issues.length} validation issue(s)).`,
    );
  }

  await dependencies.writeValue(PROJECT_MANIFEST_KEY, validation.value);
}

/** Clears the project and any legacy profile/card stores. */
export async function clearStoredProject(
  dependencies: ProjectStoreDependencies = defaultProjectStoreDependencies,
): Promise<void> {
  const keys = await dependencies.readKeys();

  for (const key of keys) {
    if (
      key === PROJECT_MANIFEST_KEY ||
      key === LEGACY_PROFILE_KEY ||
      key.startsWith(CARD_LIBRARY_KEY_PREFIX) ||
      key.startsWith(ASSET_KEY_PREFIX)
    ) {
      await dependencies.deleteValue(key);
    }
  }
}
