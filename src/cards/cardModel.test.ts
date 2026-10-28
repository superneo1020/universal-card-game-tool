import { describe, expect, it } from 'vitest';

import { validateStoredCardLibraryPayload } from '../storage/cardStore';
import type { CardRecord } from '../types/CardRecord';
import type { GameProfile } from '../types/Game';
import {
  DEFAULT_CARD_TEMPLATE_ID,
  collectCardTags,
  createCardDraft,
  createCardFace,
  filterCards,
  formatFieldValue,
  getCardFaceById,
  isCardRecordShape,
  isFieldValue,
  isPresentFieldValue,
  reconcileCard,
  seedDefaultsForCardType,
  seedDefaultsForFaceType,
  setCardAttributeValue,
  updateCardFaceById,
} from './cardModel';

function makeProfile(): GameProfile {
  return {
    id: 'profile-1',
    name: 'Test Game',
    cardTypes: ['Creature', 'Spell'],
    subtypes: ['Dragon', 'Goblin'],
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
      {
        key: 'legendary',
        label: 'Legendary',
        type: { type: 'boolean' },
        target: 'root',
      },
      {
        key: 'faction',
        label: 'Faction',
        type: { type: 'enum', options: ['Fire', 'Water'] },
        target: 'face',
      },
      {
        key: 'keywords',
        label: 'Keywords',
        type: { type: 'list', itemType: 'text' },
        target: 'face',
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
        flavorText: 'Sparks in the dark.',
        artAssetId: null,
        faceAttributes: {
          faction: 'Fire',
          keywords: ['Flying'],
        },
      },
    ],
    rootAttributes: {
      attack: 3,
      legendary: true,
    },
    tags: ['starter'],
  };
}

describe('card model', () => {
  it('creates a card draft with profile defaults', () => {
    const profile = makeProfile();
    const draft = createCardDraft(profile);

    expect(draft.profileId).toBe(profile.id);
    expect(draft.templateId).toBe(DEFAULT_CARD_TEMPLATE_ID);
    expect(draft.cardType).toBe('Creature');
    expect(draft.faces).toHaveLength(1);
    expect(draft.rootAttributes).toEqual({ attack: 0 });
    expect(draft.faces[0].faceAttributes).toEqual({});
    expect(draft.faces[0].artAssetId).toBeNull();
  });

  it('only seeds defaults that apply to the draft card type', () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push(
      {
        key: 'creatureOnly',
        label: 'Creature only',
        type: { type: 'number' },
        target: 'root',
        cardTypes: ['Creature'],
        defaultValue: 2,
      },
      {
        key: 'spellOnly',
        label: 'Spell only',
        type: { type: 'number' },
        target: 'root',
        cardTypes: ['Spell'],
        defaultValue: 7,
      },
    );

    const draft = createCardDraft(profile);

    expect(draft.rootAttributes).toEqual({ attack: 0, creatureOnly: 2 });
    expect(draft.rootAttributes.spellOnly).toBeUndefined();
  });

  it('seeds missing defaults on type changes without overwriting values', () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push(
      {
        key: 'creaturePower',
        label: 'Power',
        type: { type: 'number' },
        target: 'face',
        cardTypes: ['Creature'],
        defaultValue: 2,
      },
      {
        key: 'spellCost',
        label: 'Spell cost',
        type: { type: 'number' },
        target: 'face',
        cardTypes: ['Spell'],
        defaultValue: 3,
        required: true,
      },
      {
        key: 'creatureArmor',
        label: 'Armor',
        type: { type: 'number' },
        target: 'root',
        cardTypes: ['Creature'],
        defaultValue: 1,
      },
      {
        key: 'spellArmor',
        label: 'Spell armor',
        type: { type: 'number' },
        target: 'root',
        cardTypes: ['Spell'],
        defaultValue: 4,
      },
    );

    const asSpell = seedDefaultsForCardType(makeCard(profile), profile, 'Spell');

    expect(asSpell.rootAttributes.attack).toBe(3);
    expect(asSpell.rootAttributes.spellArmor).toBe(4);
    expect(asSpell.rootAttributes.creatureArmor).toBeUndefined();
    expect(asSpell.faces[0].faceAttributes.faction).toBe('Fire');
    expect(asSpell.faces[0].faceAttributes.spellCost).toBe(3);
    expect(reconcileCard(asSpell, profile).issues).toEqual([]);

    const faceCard = makeCard(profile);
    faceCard.faces[0].faceAttributes.spellCost = 9;
    const asCreature = seedDefaultsForFaceType(
      faceCard,
      profile,
      'front',
      'Creature',
    );

    expect(asCreature.faces[0].cardType).toBe('Creature');
    expect(asCreature.faces[0].faceAttributes.creaturePower).toBe(2);
    expect(asCreature.faces[0].faceAttributes.spellCost).toBe(9);
    expect(asCreature.faces[0].faceAttributes.faction).toBe('Fire');
    expect(reconcileCard(asCreature, profile).issues).toEqual([]);
  });

  it('adds and removes attributes without mutating the source card', () => {
    const profile = makeProfile();
    const card = makeCard(profile);

    const withFaction = setCardAttributeValue(card, 'face', 'faction', 'Water');
    expect(withFaction.faces[0].faceAttributes.faction).toBe('Water');
    expect(card.faces[0].faceAttributes.faction).toBe('Fire');

    const withoutAttack = setCardAttributeValue(
      card,
      'root',
      'attack',
      undefined,
    );
    expect(withoutAttack.rootAttributes.attack).toBeUndefined();
    expect(card.rootAttributes.attack).toBe(3);
  });

  it('accepts a card that matches the profile', () => {
    const profile = makeProfile();
    const reconciliation = reconcileCard(makeCard(profile), profile);

    expect(reconciliation.issues).toEqual([]);
    expect(reconciliation.orphaned).toEqual([]);
    expect(reconciliation.fields).toHaveLength(4);
  });

  it('reports missing required fields and incompatible values', () => {
    const profile = makeProfile();
    const missing = makeCard(profile);
    delete missing.rootAttributes.attack;

    const missingReconciliation = reconcileCard(missing, profile);
    expect(missingReconciliation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_field',
          path: '$.rootAttributes.attack',
        }),
      ]),
    );

    const incompatible = makeCard(profile);
    incompatible.rootAttributes.attack = 'three';

    const incompatibleReconciliation = reconcileCard(incompatible, profile);
    expect(incompatibleReconciliation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_field_value',
          path: '$.rootAttributes.attack',
        }),
      ]),
    );
  });

  it('preserves orphaned values without blocking the card', () => {
    const profile = makeProfile();
    const card = makeCard(profile);
    card.rootAttributes.rage = 2;
    card.faces[0].faceAttributes.inscription = 'Ancient';

    const reconciliation = reconcileCard(card, profile);

    expect(reconciliation.issues).toEqual([]);
    expect(reconciliation.orphaned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'rage',
          target: 'root',
          value: 2,
        }),
        expect.objectContaining({
          key: 'inscription',
          target: 'face',
          value: 'Ancient',
        }),
      ]),
    );
  });

  it('reports card types and subtypes that no longer exist', () => {
    const profile = makeProfile();
    const card = makeCard(profile);
    card.cardType = 'Land';
    card.subtypes = ['Angel'];

    const reconciliation = reconcileCard(card, profile);

    expect(reconciliation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_reference',
          path: '$.cardType',
        }),
        expect.objectContaining({
          code: 'invalid_reference',
          path: '$.subtypes[0]',
        }),
      ]),
    );
  });

  it('updates and reconciles faces independently', () => {
    const profile = makeProfile();
    const card = makeCard(profile);
    const back = createCardFace(profile, 'back');
    back.faceAttributes = { faction: 'Water', keywords: ['Flying'] };
    card.faces.push(back);

    const updated = updateCardFaceById(card, 'back', {
      rulesText: 'Back rules',
      flavorText: 'Back flavor',
    });
    expect(updated.faces[0].rulesText).toBe('Flying');
    expect(updated.faces[1].rulesText).toBe('Back rules');
    expect(getCardFaceById(updated, 'back')?.flavorText).toBe('Back flavor');

    const withFaction = setCardAttributeValue(
      card,
      'face',
      'faction',
      'Water',
      'back',
    );
    expect(withFaction.faces[0].faceAttributes.faction).toBe('Fire');
    expect(withFaction.faces[1].faceAttributes.faction).toBe('Water');

    const reconciliation = reconcileCard(card, profile);
    expect(reconciliation.faces).toHaveLength(2);
    expect(reconciliation.faces[1].fields).toHaveLength(2);

    card.faces[1].faceAttributes.faction = 'Shadow';
    const invalid = reconcileCard(card, profile);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.faces[1].faceAttributes.faction',
        }),
      ]),
    );
  });

  it('applies field definitions only to matching card types', () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push(
      {
        key: 'power',
        label: 'Power',
        type: { type: 'number' },
        target: 'root',
        cardTypes: ['Creature'],
        required: true,
      },
      {
        key: 'spellCost',
        label: 'Spell cost',
        type: { type: 'number' },
        target: 'face',
        cardTypes: ['Spell'],
      },
    );

    const creature = makeCard(profile);
    creature.rootAttributes.power = 2;
    const creatureReconciliation = reconcileCard(creature, profile);

    expect(creatureReconciliation.issues).toEqual([]);
    expect(creatureReconciliation.orphaned).toEqual([]);
    expect(
      creatureReconciliation.fields.map((field) => field.definition.key),
    ).toContain('power');
    expect(
      creatureReconciliation.fields.map((field) => field.definition.key),
    ).not.toContain('spellCost');

    const spell = makeCard(profile);
    spell.cardType = 'Spell';
    spell.faces[0].faceAttributes = {
      faction: 'Water',
      keywords: ['Flying'],
      spellCost: 2,
    };
    const spellReconciliation = reconcileCard(spell, profile);

    expect(spellReconciliation.issues).toEqual([]);
    expect(spellReconciliation.orphaned).toEqual([]);
    expect(
      spellReconciliation.fields.map((field) => field.definition.key),
    ).toContain('spellCost');
    expect(
      spellReconciliation.fields.map((field) => field.definition.key),
    ).not.toContain('power');
  });

  it('uses face type and subtype overrides for fields and search', () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push(
      {
        key: 'creaturePower',
        label: 'Power',
        type: { type: 'number' },
        target: 'face',
        cardTypes: ['Creature'],
      },
      {
        key: 'spellCost',
        label: 'Spell cost',
        type: { type: 'number' },
        target: 'face',
        cardTypes: ['Spell'],
      },
    );
    const card = makeCard(profile);
    card.faces[0].faceAttributes = {
      faction: 'Fire',
      keywords: ['Flying'],
      creaturePower: 4,
    };
    card.faces.push({
      faceId: 'back',
      name: 'Dragon Form',
      cardType: 'Spell',
      subtypes: ['Goblin'],
      rulesText: 'Transform',
      artAssetId: null,
      faceAttributes: {
        faction: 'Water',
        keywords: ['Flying'],
        spellCost: 2,
      },
    });

    const reconciliation = reconcileCard(card, profile);

    expect(reconciliation.issues).toEqual([]);
    expect(reconciliation.orphaned).toEqual([]);
    expect(
      reconciliation.faces[0].fields.map((field) => field.definition.key),
    ).toContain('creaturePower');
    expect(
      reconciliation.faces[0].fields.map((field) => field.definition.key),
    ).not.toContain('spellCost');
    expect(
      reconciliation.faces[1].fields.map((field) => field.definition.key),
    ).toContain('spellCost');
    expect(
      reconciliation.faces[1].fields.map((field) => field.definition.key),
    ).not.toContain('creaturePower');
    expect(isCardRecordShape(card)).toBe(true);
    expect(filterCards([card], 'Dragon Form', null)).toHaveLength(1);
    expect(filterCards([card], 'Goblin', null)).toHaveLength(1);
  });

  it('searches and formats structured entry values', () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push({
      key: 'cost',
      label: 'Cost',
      target: 'face',
      type: {
        type: 'structured',
        children: [
          {
            key: 'resource',
            label: 'Resource',
            type: { type: 'enum', options: ['Generic', 'Red'] },
          },
          {
            key: 'amount',
            label: 'Amount',
            type: { type: 'number' },
          },
        ],
      },
    });
    const card = makeCard(profile);
    card.faces[0].faceAttributes.cost = [
      { entryId: 'cost-1', values: { resource: 'Red', amount: 2 } },
    ];

    expect(reconcileCard(card, profile).issues).toEqual([]);
    expect(isFieldValue(card.faces[0].faceAttributes.cost)).toBe(true);
    expect(isFieldValue([{ entryId: '', values: {} }])).toBe(false);
    expect(formatFieldValue(card.faces[0].faceAttributes.cost)).toBe('Red · 2');
    expect(filterCards([card], 'red', null)).toEqual([card]);
    expect(filterCards([card], '2', null)).toEqual([card]);
  });

  it('searches and formats nested structured level values', () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push({
      key: 'levels',
      label: 'Levels',
      target: 'face',
      type: {
        type: 'structured',
        children: [
          {
            key: 'level',
            label: 'Level',
            type: { type: 'number' },
          },
          {
            key: 'energy',
            label: 'Energy',
            type: {
              type: 'structured',
              children: [
                {
                  key: 'resource',
                  label: 'Resource',
                  type: { type: 'enum', options: ['Red', 'Generic'] },
                },
                {
                  key: 'amount',
                  label: 'Amount',
                  type: { type: 'number' },
                },
              ],
            },
          },
        ],
      },
    });
    const card = makeCard(profile);
    card.faces[0].faceAttributes.levels = [
      {
        entryId: 'level-1',
        values: {
          level: 1,
          energy: [
            {
              entryId: 'energy-1',
              values: { resource: 'Red', amount: 2 },
            },
          ],
        },
      },
    ];

    expect(reconcileCard(card, profile).issues).toEqual([]);
    expect(isFieldValue(card.faces[0].faceAttributes.levels)).toBe(true);
    expect(formatFieldValue(card.faces[0].faceAttributes.levels)).toBe(
      '1 · Red · 2',
    );
    expect(filterCards([card], 'red', null)).toEqual([card]);
  });

  it('filters by query and tag', () => {
    const profile = makeProfile();
    const dragon = makeCard(profile);
    const spell: CardRecord = {
      ...makeCard(profile),
      id: 'card-2',
      name: 'Arc Bolt',
      cardType: 'Spell',
      subtypes: [],
      tags: ['burn'],
      rootAttributes: { attack: 1 },
      faces: [
        {
          faceId: 'front',
          rulesText: 'Deal damage.',
          artAssetId: null,
          faceAttributes: {},
        },
      ],
    };

    expect(filterCards([dragon, spell], 'drag', null)).toEqual([dragon]);
    expect(filterCards([dragon, spell], 'spell', null)).toEqual([spell]);
    expect(filterCards([dragon, spell], 'burn', null)).toEqual([spell]);
    expect(filterCards([dragon, spell], 'flying', null)).toEqual([dragon]);
    expect(filterCards([dragon, spell], 'sparks', null)).toEqual([dragon]);
    expect(filterCards([dragon, spell], 'fire', null)).toEqual([dragon]);
    expect(filterCards([dragon, spell], '3', null)).toEqual([dragon]);
    expect(filterCards([dragon, spell], 'true', null)).toEqual([dragon]);
    expect(filterCards([dragon, spell], '', 'starter')).toEqual([dragon]);
    expect(filterCards([dragon, spell], 'missing', null)).toEqual([]);
  });

  it('collects sorted unique tags', () => {
    const profile = makeProfile();
    const first = makeCard(profile);
    const second = makeCard(profile);
    second.tags = ['zzz', 'alpha'];
    first.tags = ['starter', 'alpha'];

    expect(collectCardTags([first, second])).toEqual([
      'alpha',
      'starter',
      'zzz',
    ]);
  });

  it('formats values for previews', () => {
    expect(formatFieldValue(['A', 'B'])).toBe('A, B');
    expect(formatFieldValue([])).toBe('—');
    expect(formatFieldValue(true)).toBe('Yes');
    expect(formatFieldValue(3)).toBe('3');
  });

  it('treats empty text and lists as absent while keeping zero and false', () => {
    expect(isPresentFieldValue(undefined)).toBe(false);
    expect(isPresentFieldValue('')).toBe(false);
    expect(isPresentFieldValue('   ')).toBe(false);
    expect(isPresentFieldValue([])).toBe(false);
    expect(isPresentFieldValue([''])).toBe(false);
    expect(isPresentFieldValue(0)).toBe(true);
    expect(isPresentFieldValue(false)).toBe(true);
    expect(isPresentFieldValue('0')).toBe(true);
    expect(isPresentFieldValue([0])).toBe(true);
  });

  it('validates stored library payloads', () => {
    const profile = makeProfile();
    const card = makeCard(profile);
    const payload = {
      schemaVersion: 1,
      profileId: profile.id,
      cards: [card],
    };

    expect(
      validateStoredCardLibraryPayload(payload, profile.id).ok,
    ).toBe(true);
    expect(isCardRecordShape(card)).toBe(true);

    const wrongVersion = {
      ...payload,
      schemaVersion: 2,
    };
    const versionResult = validateStoredCardLibraryPayload(
      wrongVersion,
      profile.id,
    );
    expect(versionResult.ok).toBe(false);
    if (!versionResult.ok) {
      expect(versionResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_version',
            path: '$.schemaVersion',
          }),
        ]),
      );
    }

    const wrongProfile = {
      ...payload,
      profileId: 'profile-2',
    };
    const profileResult = validateStoredCardLibraryPayload(
      wrongProfile,
      profile.id,
    );
    expect(profileResult.ok).toBe(false);

    const malformedCard = {
      ...payload,
      cards: [{ id: 'bad' }],
    };
    const cardResult = validateStoredCardLibraryPayload(
      malformedCard,
      profile.id,
    );
    expect(cardResult.ok).toBe(false);
    if (!cardResult.ok) {
      expect(cardResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_literal',
            path: '$.cards[0]',
          }),
        ]),
      );
    }
  });

  it('allows orphaned attributes through structural persistence validation', () => {
    const profile = makeProfile();
    const card = makeCard(profile);
    card.rootAttributes.rage = 2;
    card.faces[0].faceAttributes.inscription = 'Ancient';

    const result = validateStoredCardLibraryPayload(
      { schemaVersion: 1, profileId: profile.id, cards: [card] },
      profile.id,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects foreign-profile and duplicate card records', () => {
    const profile = makeProfile();
    const card = makeCard(profile);

    const foreignCard = structuredClone(card);
    foreignCard.profileId = 'profile-2';
    const foreignResult = validateStoredCardLibraryPayload(
      {
        schemaVersion: 1,
        profileId: profile.id,
        cards: [foreignCard],
      },
      profile.id,
    );

    expect(foreignResult.ok).toBe(false);
    if (!foreignResult.ok) {
      expect(foreignResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unresolved_reference',
            path: '$.cards[0].profileId',
          }),
        ]),
      );
    }

    const duplicateResult = validateStoredCardLibraryPayload(
      {
        schemaVersion: 1,
        profileId: profile.id,
        cards: [card, structuredClone(card)],
      },
      profile.id,
    );

    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'duplicate_id',
            path: '$.cards[1].id',
          }),
        ]),
      );
    }
  });
});
