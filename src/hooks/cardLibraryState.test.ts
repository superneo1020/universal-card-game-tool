import { describe, expect, it } from 'vitest';

import { DEFAULT_CARD_TEMPLATE_ID } from '../cards/cardModel';
import type { CardRecord } from '../types/CardRecord';
import type { CardLibraryState } from './useCardLibrary';
import { completeCardLibraryWrite } from './useCardLibrary';

function makeCard(id: string, profileId: string): CardRecord {
  return {
    id,
    profileId,
    templateId: DEFAULT_CARD_TEMPLATE_ID,
    name: id,
    cardType: 'Creature',
    subtypes: [],
    faces: [
      {
        faceId: 'front',
        rulesText: '',
        artAssetId: null,
        faceAttributes: {},
      },
    ],
    rootAttributes: {},
    tags: [],
  };
}

function makeState(
  profileId: string,
  cards: readonly CardRecord[],
): CardLibraryState {
  return {
    status: 'ready',
    profileId,
    cards,
    loadErrorMessage: null,
    loadIssues: [],
    saving: true,
    saveErrorMessage: null,
    savedAt: null,
  };
}

describe('completeCardLibraryWrite', () => {
  it('applies a completed write to the matching profile', () => {
    const current = makeState('profile-1', []);
    const card = makeCard('card-1', 'profile-1');
    const savedAt = '2026-01-01T00:00:00.000Z';

    const result = completeCardLibraryWrite(
      current,
      'profile-1',
      [card],
      savedAt,
    );

    expect(result.cards).toEqual([card]);
    expect(result.saving).toBe(false);
    expect(result.savedAt).toBe(savedAt);
  });

  it('ignores a delayed write after the active profile changes', () => {
    const activeCard = makeCard('card-2', 'profile-2');
    const current = makeState('profile-2', [activeCard]);
    const staleCard = makeCard('card-1', 'profile-1');

    const result = completeCardLibraryWrite(
      current,
      'profile-1',
      [staleCard],
      '2026-01-01T00:00:00.000Z',
    );

    expect(result).toBe(current);
    expect(result.cards).toEqual([activeCard]);
  });
});
