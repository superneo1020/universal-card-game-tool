import { describe, expect, it } from 'vitest';

import {
  createBlankGameProfile,
  createEmptyFieldDefinition,
  isProfileDraftDirty,
  isProfileReady,
} from './profileFactory';

describe('game profile factory', () => {
  it('creates a complete first-run draft', () => {
    const profile = createBlankGameProfile();

    expect(profile.id.length).toBeGreaterThan(0);
    expect(profile.name.length).toBeGreaterThan(0);
    expect(profile.cardTypes).toEqual([]);
    expect(profile.subtypes).toEqual([]);
    expect(profile.keywords).toEqual([]);
    expect(profile.fieldDefinitions).toEqual([]);
    expect(profile.deckRules).toEqual({
      minSize: 40,
      maxSize: 60,
      maxCopiesPerCard: 4,
    });
  });

  it('creates a blank field definition with a text type', () => {
    const field = createEmptyFieldDefinition();

    expect(field.key).toBe('');
    expect(field.label).toBe('');
    expect(field.type).toEqual({ type: 'text' });
    expect(field.target).toBe('face');
    expect(field.required).toBe(false);
  });

  it('only reports readiness with a name and a card type', () => {
    const profile = createBlankGameProfile();

    expect(isProfileReady(null)).toBe(false);
    expect(isProfileReady(profile)).toBe(false);

    profile.cardTypes.push('Creature');
    expect(isProfileReady(profile)).toBe(true);

    profile.name = '   ';
    expect(isProfileReady(profile)).toBe(false);
  });

  it('treats a first-run draft as unsaved', () => {
    const draft = createBlankGameProfile();

    expect(isProfileDraftDirty(null, draft)).toBe(true);
  });

  it('detects unsaved draft changes', () => {
    const profile = createBlankGameProfile();
    const draft = structuredClone(profile);

    expect(isProfileDraftDirty(profile, draft)).toBe(false);
    expect(isProfileDraftDirty(null, null)).toBe(false);

    draft.name = 'Changed';
    expect(isProfileDraftDirty(profile, draft)).toBe(true);
  });
});
