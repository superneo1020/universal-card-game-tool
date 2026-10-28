import { describe, expect, it } from 'vitest';

import { createProjectManifest } from '../project/projectModel';
import type { GameProfile } from '../types/Game';
import type { UseProjectResult } from './useProject';
import {
  completeProfileProjectSave,
  completeProjectWrite,
} from './useProject';

function makeProfile(name = 'Test Game'): GameProfile {
  return {
    id: 'profile-1',
    name,
    cardTypes: ['Creature'],
    subtypes: [],
    keywords: [],
    fieldDefinitions: [],
    deckRules: { minSize: 40, maxSize: 60, maxCopiesPerCard: 4 },
  };
}

function makeState(): UseProjectResult['state'] {
  const project = createProjectManifest(makeProfile());

  return {
    status: 'ready',
    project,
    profileDraft: structuredClone(project.profile),
    loadErrorMessage: null,
    loadIssues: [],
    saving: true,
    saveIssues: [],
    saveErrorMessage: null,
    savedAt: null,
    profileSavedAt: null,
  };
}

const SAVED_AT = '2026-01-01T00:00:00.000Z';

describe('project write completion guards', () => {
  it('applies a profile save to the matching generation', () => {
    const state = makeState();
    const submitted = structuredClone(state.project?.profile as GameProfile);
    const savedProject = {
      ...(state.project as NonNullable<typeof state.project>),
      profile: submitted,
    };

    const result = completeProfileProjectSave(
      state,
      1,
      1,
      submitted,
      savedProject,
      SAVED_AT,
    );

    expect(result.project).toBe(savedProject);
    expect(result.profileDraft).toEqual(submitted);
    expect(result.saving).toBe(false);
    expect(result.profileSavedAt).toBe(SAVED_AT);
  });

  it('ignores a delayed profile save after a profile switch', () => {
    const state = makeState();
    const submitted = structuredClone(state.project?.profile as GameProfile);

    const result = completeProfileProjectSave(
      state,
      1,
      2,
      submitted,
      state.project as NonNullable<typeof state.project>,
      SAVED_AT,
    );

    expect(result).toBe(state);
  });

  it('preserves a newer profile draft made during the save', () => {
    const state = makeState();
    const submitted = structuredClone(state.project?.profile as GameProfile);
    const newerDraft = structuredClone(submitted);
    newerDraft.name = 'Edited during save';
    const stateWithNewerDraft: UseProjectResult['state'] = {
      ...state,
      profileDraft: newerDraft,
    };
    const savedProject = {
      ...(state.project as NonNullable<typeof state.project>),
      profile: submitted,
    };

    const result = completeProfileProjectSave(
      stateWithNewerDraft,
      1,
      1,
      submitted,
      savedProject,
      SAVED_AT,
    );

    expect(result.profileDraft).toBe(newerDraft);
    expect(result.project?.profile.name).toBe('Test Game');
  });

  it('ignores a delayed card write after a project switch', () => {
    const state = makeState();
    const savedProject = state.project as NonNullable<typeof state.project>;

    const stale = completeProjectWrite(
      state,
      1,
      2,
      savedProject,
      SAVED_AT,
    );

    expect(stale).toBe(state);

    const applied = completeProjectWrite(
      state,
      1,
      1,
      savedProject,
      SAVED_AT,
    );

    expect(applied.project).toBe(savedProject);
    expect(applied.saving).toBe(false);
    expect(applied.savedAt).toBe(SAVED_AT);
  });
});
