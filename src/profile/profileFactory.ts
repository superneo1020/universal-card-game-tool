import type { FieldDefinition, GameProfile } from '../types/Game';
import { createUniqueId } from '../utils/ids';

/** Creates the first-run draft profile. */
export function createBlankGameProfile(): GameProfile {
  return {
    id: createUniqueId('profile'),
    name: 'My Card Game',
    cardTypes: [],
    subtypes: [],
    keywords: [],
    fieldDefinitions: [],
    deckRules: {
      minSize: 40,
      maxSize: 60,
      maxCopiesPerCard: 4,
    },
  };
}

/** Creates an empty field row ready for editing. */
export function createEmptyFieldDefinition(): FieldDefinition {
  return {
    key: '',
    label: '',
    type: { type: 'text' },
    target: 'face',
    required: false,
  };
}

/**
 * A profile is ready to drive the card library once it has a name and at least
 * one card type. Field definitions remain optional because some games only use
 * core card text.
 */
export function isProfileReady(profile: GameProfile | null): boolean {
  return (
    profile !== null &&
    profile.name.trim().length > 0 &&
    profile.cardTypes.length > 0
  );
}

/**
 * Compares the working draft with the last persisted profile.
 *
 * Profiles are small JSON structures, so a stable serialization comparison is
 * sufficient and avoids a deep-equality dependency.
 */
export function isProfileDraftDirty(
  persistedProfile: GameProfile | null,
  draft: GameProfile | null,
): boolean {
  if (draft === null) {
    return false;
  }

  if (persistedProfile === null) {
    return true;
  }

  return JSON.stringify(persistedProfile) !== JSON.stringify(draft);
}
