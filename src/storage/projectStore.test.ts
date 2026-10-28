import { describe, expect, it } from 'vitest';

import { DEFAULT_CARD_TEMPLATE_ID } from '../cards/cardModel';
import { createProjectManifest } from '../project/projectModel';
import type { CardRecord } from '../types/CardRecord';
import type { GameProfile } from '../types/Game';
import type { ProjectManifest } from '../types/ProjectManifest';
import { CURRENT_SCHEMA_VERSION } from '../types/ProjectManifest';
import type { StoredCardLibraryLoadResult } from './cardStore';
import { PROJECT_MANIFEST_KEY, LEGACY_PROFILE_KEY } from './keys';
import type { StoredProfileLoadResult } from './profileStore';
import type { ProjectStoreDependencies } from './projectStore';
import { loadStoredProject, saveStoredProject } from './projectStore';

function makeProfile(): GameProfile {
  return {
    id: 'profile-1',
    name: 'Test Game',
    cardTypes: ['Creature'],
    subtypes: ['Dragon'],
    keywords: ['Flying'],
    fieldDefinitions: [
      {
        key: 'attack',
        label: 'Attack',
        type: { type: 'number' },
        target: 'root',
        required: true,
        defaultValue: 0,
      },
    ],
    deckRules: { minSize: 40, maxSize: 60, maxCopiesPerCard: 4 },
  };
}

function makeCard(profile: GameProfile): CardRecord {
  return {
    id: 'card-1',
    profileId: profile.id,
    templateId: DEFAULT_CARD_TEMPLATE_ID,
    name: 'Dragon',
    cardType: 'Creature',
    subtypes: ['Dragon'],
    faces: [
      {
        faceId: 'front',
        rulesText: 'Flying',
        artAssetId: null,
        faceAttributes: {},
      },
    ],
    rootAttributes: { attack: 3 },
    tags: ['starter'],
  };
}

function loadedProfile(profile: GameProfile): StoredProfileLoadResult {
  return { kind: 'loaded', profile };
}

function loadedCards(
  cards: readonly CardRecord[],
): StoredCardLibraryLoadResult {
  return { kind: 'loaded', cards };
}

interface RecordedWrite {
  readonly key: string;
  readonly value: unknown;
  readonly keysToDelete: readonly string[];
}

interface DependencyHarness {
  readonly dependencies: ProjectStoreDependencies;
  readonly writes: RecordedWrite[];
  readonly deletes: string[];
}

function makeDependencies(
  overrides: Partial<ProjectStoreDependencies> = {},
): DependencyHarness {
  const writes: RecordedWrite[] = [];
  const deletes: string[] = [];
  const profile = makeProfile();

  const dependencies: ProjectStoreDependencies = {
    readValue: async () => undefined,
    writeValue: async () => undefined,
    writeValueAndDeleteKeys: async (key, value, keysToDelete) => {
      writes.push({ key, value, keysToDelete: [...keysToDelete] });
    },
    deleteValue: async (key) => {
      deletes.push(key);
    },
    readKeys: async () => [],
    loadLegacyProfile: async () => loadedProfile(profile),
    loadLegacyCardLibrary: async () =>
      loadedCards([makeCard(profile)]),
    ...overrides,
  };

  return { dependencies, writes, deletes };
}

describe('project store', () => {
  it('migrates legacy profile and card data into one manifest transaction', async () => {
    const { dependencies, writes, deletes } = makeDependencies();

    const result = await loadStoredProject(dependencies);

    expect(result.kind).toBe('loaded');
    if (result.kind === 'loaded') {
      expect(result.migratedFromLegacy).toBe(true);
      expect(result.project.cards.map((card) => card.id)).toEqual(['card-1']);
      expect(result.project.templates).toHaveLength(1);
    }

    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe(PROJECT_MANIFEST_KEY);
    expect(writes[0]?.keysToDelete).toEqual([
      LEGACY_PROFILE_KEY,
      'card-library:profile-1',
    ]);
    expect(deletes).toEqual([]);
  });

  it('surfaces failed migration writes instead of reporting partial success', async () => {
    const { dependencies, deletes } = makeDependencies({
      writeValueAndDeleteKeys: async () => {
        throw new Error('disk full');
      },
    });

    const result = await loadStoredProject(dependencies);

    expect(result).toEqual({ kind: 'error', message: 'disk full' });
    expect(deletes).toEqual([]);
  });

  it('upgrades a stored v1 manifest and persists the version marker', async () => {
    const project = createProjectManifest(makeProfile());
    const v1Manifest: unknown = {
      ...structuredClone(project),
      schemaVersion: 1,
    };
    const recordedWrites: RecordedWrite[] = [];
    const { dependencies } = makeDependencies({
      readValue: async (key) =>
        key === PROJECT_MANIFEST_KEY ? v1Manifest : undefined,
      writeValue: async (key, value) => {
        recordedWrites.push({ key, value, keysToDelete: [] });
      },
    });

    const result = await loadStoredProject(dependencies);

    expect(result.kind).toBe('loaded');
    if (result.kind === 'loaded') {
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.project.projectId).toBe(project.projectId);
    }

    expect(recordedWrites).toHaveLength(1);
    expect(recordedWrites[0]?.key).toBe(PROJECT_MANIFEST_KEY);
    expect(
      (recordedWrites[0]?.value as { schemaVersion?: unknown }).schemaVersion,
    ).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('loads an existing manifest without touching legacy storage', async () => {
    const project = createProjectManifest(makeProfile());
    const { dependencies } = makeDependencies({
      readValue: async (key) =>
        key === PROJECT_MANIFEST_KEY ? project : undefined,
      loadLegacyProfile: async () => {
        throw new Error('Legacy storage should not be read.');
      },
    });

    const result = await loadStoredProject(dependencies);

    expect(result.kind).toBe('loaded');
    if (result.kind === 'loaded') {
      expect(result.migratedFromLegacy).toBe(false);
      expect(result.project.projectId).toBe(project.projectId);
    }
  });

  it('returns legacy validation issues without writing a manifest', async () => {
    const { dependencies, writes } = makeDependencies({
      loadLegacyCardLibrary: async () => ({
        kind: 'invalid',
        issues: [
          {
            path: '$.cards[0]',
            code: 'invalid_literal',
            message: 'Stored card record is malformed.',
          },
        ],
      }),
    });

    const result = await loadStoredProject(dependencies);

    expect(result.kind).toBe('invalid');
    expect(writes).toEqual([]);
  });

  it('propagates project write failures from saveStoredProject', async () => {
    const { dependencies } = makeDependencies({
      writeValue: async () => {
        throw new Error('quota exceeded');
      },
    });
    const project: ProjectManifest = createProjectManifest(makeProfile());

    await expect(saveStoredProject(project, dependencies)).rejects.toThrow(
      'quota exceeded',
    );
  });
});
