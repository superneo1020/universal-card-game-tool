import { describe, expect, it } from 'vitest';

import { createBlankGameProfile, isProfileDraftDirty } from './profileFactory';
import { completeProfileSave } from './profileSave';

const SAVED_AT = '2026-01-01T00:00:00.000Z';

describe('completeProfileSave', () => {
  it('adopts the submitted profile when the draft has not changed', () => {
    const submitted = createBlankGameProfile();

    const result = completeProfileSave(
      submitted,
      structuredClone(submitted),
      SAVED_AT,
    );

    expect(result.profile).toEqual(submitted);
    expect(result.draft).toEqual(submitted);
    expect(result.draft).not.toBe(submitted);
    expect(result.savedAt).toBe(SAVED_AT);
    expect(isProfileDraftDirty(result.profile, result.draft)).toBe(false);
  });

  it('preserves edits made while the save was in flight', () => {
    const submitted = createBlankGameProfile();
    const newerDraft = structuredClone(submitted);
    newerDraft.name = 'Edited during save';
    newerDraft.cardTypes.push('Spell');

    const result = completeProfileSave(submitted, newerDraft, SAVED_AT);

    expect(result.profile.name).toBe('My Card Game');
    expect(result.profile.cardTypes).toEqual([]);
    expect(result.draft.name).toBe('Edited during save');
    expect(result.draft.cardTypes).toEqual(['Spell']);
    expect(isProfileDraftDirty(result.profile, result.draft)).toBe(true);
  });

  it('falls back to the submitted profile when no draft is available', () => {
    const submitted = createBlankGameProfile();

    const result = completeProfileSave(submitted, null, SAVED_AT);

    expect(result.profile).toEqual(submitted);
    expect(result.draft).toEqual(submitted);
    expect(result.draft).not.toBe(submitted);
  });
});
