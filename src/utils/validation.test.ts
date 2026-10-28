import { describe, expect, it } from 'vitest';

import type { CardRecord } from '../types/CardRecord';
import type { Deck } from '../types/Collection';
import type { FieldDefinition } from '../types/Game';
import type { ProjectManifest, ProjectManifestV0 } from '../types/ProjectManifest';
import {
  analyzeProjectImport,
  computeSha256Hex,
  detectIdCollisions,
  isGameProfile,
  isProjectManifest,
  migrateProjectManifest,
  parseProjectManifestJson,
  validateAssetBytes,
  validateFieldDefinition,
  validateFieldValue,
  validateGameProfile,
  validateProjectManifest,
} from './validation';
import type { ValidationIssueCode } from './validation';

const ASSET_A = 'a'.repeat(64);
const ASSET_B = 'b'.repeat(64);

function makeManifest(): ProjectManifest {
  return {
    schemaVersion: 2,
    projectId: 'proj-1',
    projectName: 'Test Project',
    createdAt: '2026-01-01T00:00:00.000Z',
    profile: {
      id: 'profile-1',
      name: 'Fantasy',
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
          defaultValue: 'Fire',
        },
        {
          key: 'keywords',
          label: 'Keywords',
          type: { type: 'list', itemType: 'text' },
          target: 'face',
        },
      ],
      deckRules: { minSize: 40, maxSize: 60, maxCopiesPerCard: 4 },
    },
    templates: [
      {
        id: 'tpl-1',
        profileId: 'profile-1',
        name: 'Standard',
        layout: 'single',
        blocks: [
          {
            id: 'b1',
            type: 'header',
            designTokenStyle: 'header.primary',
            mappingKey: 'name',
            order: 0,
          },
          {
            id: 'b2',
            type: 'art_box',
            designTokenStyle: 'art.default',
            mappingKey: 'artAssetId',
            order: 1,
          },
          {
            id: 'b3',
            type: 'stat_badge',
            designTokenStyle: 'stat.primary',
            mappingKey: 'attack',
            order: 2,
          },
        ],
      },
    ],
    cards: [
      {
        id: 'card-1',
        profileId: 'profile-1',
        templateId: 'tpl-1',
        name: 'Dragon',
        cardType: 'Creature',
        subtypes: ['Dragon'],
        faces: [
          {
            faceId: 'front',
            rulesText: 'Flying',
            artAssetId: ASSET_A,
            faceAttributes: { faction: 'Fire', keywords: ['Flying'] },
          },
        ],
        rootAttributes: { attack: 3, legendary: false },
        tags: ['starter'],
      },
    ],
    packs: [
      {
        id: 'pack-1',
        name: 'Starter',
        description: 'Starter cards',
        cardIds: ['card-1'],
        releaseDate: '2026-01-01',
      },
    ],
    decks: [
      {
        id: 'deck-1',
        profileId: 'profile-1',
        name: 'Aggro',
        format: 'Standard',
        entries: [{ cardId: 'card-1', count: 4 }],
        tags: ['aggro'],
      },
    ],
    assets: [
      {
        assetId: ASSET_A,
        fileName: 'dragon.png',
        relativePathHint: 'art/dragon.png',
        mimeType: 'image/png',
        byteSize: 1024,
      },
    ],
  };
}

function makeLegacyCard(card: CardRecord): ProjectManifestV0['cards'][number] {
  return {
    id: card.id,
    profileId: card.profileId,
    templateId: card.templateId,
    name: card.name,
    cardType: card.cardType,
    faces: card.faces,
    rootAttributes: card.rootAttributes,
  };
}

function makeLegacyDeck(deck: Deck): ProjectManifestV0['decks'][number] {
  return {
    id: deck.id,
    profileId: deck.profileId,
    name: deck.name,
    format: deck.format,
    entries: deck.entries,
  };
}

function makeLegacyManifest(): ProjectManifestV0 {
  const manifest = makeManifest();

  return {
    schemaVersion: 0,
    projectId: manifest.projectId,
    projectName: manifest.projectName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    profile: manifest.profile,
    templates: manifest.templates,
    cards: manifest.cards.map(makeLegacyCard),
    decks: manifest.decks.map(makeLegacyDeck),
    assets: manifest.assets,
  };
}

function expectIssue(
  data: unknown,
  code: ValidationIssueCode,
  path: string,
): void {
  const result = validateProjectManifest(data);
  expect(result.ok).toBe(false);

  if (!result.ok) {
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, path })]),
    );
  }
}

describe('valid manifest', () => {
  it('accepts a complete project across every layer', () => {
    expect(isProjectManifest(makeManifest())).toBe(true);
    expect(validateProjectManifest(makeManifest()).ok).toBe(true);
  });

  it('accepts a card face with no artwork', () => {
    const manifest = makeManifest();
    manifest.cards[0].faces[0].artAssetId = null;
    expect(validateProjectManifest(manifest).ok).toBe(true);
  });
});

describe('standalone game profile guard', () => {
  it('accepts a valid profile', () => {
    const profile = structuredClone(makeManifest().profile);

    expect(isGameProfile(profile)).toBe(true);
    expect(validateGameProfile(profile).ok).toBe(true);
  });

  it('rejects duplicate field keys', () => {
    const profile = structuredClone(makeManifest().profile);
    profile.fieldDefinitions.push({
      ...structuredClone(profile.fieldDefinitions[0]),
      label: 'Copy',
    });

    const result = validateGameProfile(profile);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'duplicate_id',
            path: '$.fieldDefinitions[4].key',
          }),
        ]),
      );
    }
  });

  it('rejects invalid defaults and deck rules', () => {
    const profile = structuredClone(makeManifest().profile);
    profile.fieldDefinitions[2].defaultValue = 'Earth';
    profile.deckRules.minSize = 80;

    const result = validateGameProfile(profile);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_default_value',
            path: '$.fieldDefinitions[2].defaultValue',
          }),
          expect.objectContaining({
            code: 'out_of_range',
            path: '$.deckRules.maxSize',
          }),
        ]),
      );
    }
  });

  it('rejects non-object profile input', () => {
    expect(isGameProfile(null)).toBe(false);
    expect(isGameProfile('profile')).toBe(false);
    expect(validateGameProfile([]).ok).toBe(false);
  });

  it('rejects field applicability that names undeclared card types', () => {
    const profile = structuredClone(makeManifest().profile);
    profile.fieldDefinitions[0].cardTypes = ['Land'];

    const result = validateGameProfile(profile);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_reference',
            path: '$.fieldDefinitions[0].cardTypes[0]',
          }),
        ]),
      );
    }
  });
});

describe('shape and field validation', () => {
  it('rejects non-object roots', () => {
    for (const value of [null, undefined, 'manifest', 42, [], true]) {
      expect(isProjectManifest(value)).toBe(false);
      expectIssue(value, 'expected_object', '$');
    }
  });

  it('rejects bare-string FieldType variants', () => {
    const manifest = makeManifest();
    const invalid: unknown = {
      ...manifest,
      profile: {
        ...manifest.profile,
        fieldDefinitions: [
          { ...manifest.profile.fieldDefinitions[0], type: 'number' },
        ],
      },
    };

    expectIssue(invalid, 'expected_object', '$.profile.fieldDefinitions[0].type');
  });

  it('rejects unknown FieldType discriminators', () => {
    const manifest = makeManifest();
    const invalid: unknown = {
      ...manifest,
      profile: {
        ...manifest.profile,
        fieldDefinitions: [
          { ...manifest.profile.fieldDefinitions[0], type: { type: 'date' } },
        ],
      },
    };

    expectIssue(invalid, 'invalid_literal', '$.profile.fieldDefinitions[0].type.type');
  });

  it('rejects enum fields without options or with duplicates', () => {
    const manifest = makeManifest();

    const emptyOptions: unknown = {
      ...manifest,
      profile: {
        ...manifest.profile,
        fieldDefinitions: [
          {
            ...manifest.profile.fieldDefinitions[0],
            type: { type: 'enum', options: [] },
          },
        ],
      },
    };
    expectIssue(emptyOptions, 'invalid_literal', '$.profile.fieldDefinitions[0].type.options');

    const duplicateOptions: unknown = {
      ...manifest,
      profile: {
        ...manifest.profile,
        fieldDefinitions: [
          {
            ...manifest.profile.fieldDefinitions[0],
            type: { type: 'enum', options: ['Fire', 'Fire'] },
          },
        ],
      },
    };
    expectIssue(duplicateOptions, 'duplicate_value', '$.profile.fieldDefinitions[0].type.options[1]');
  });

  it('rejects invalid list item types', () => {
    const manifest = makeManifest();
    const invalid: unknown = {
      ...manifest,
      profile: {
        ...manifest.profile,
        fieldDefinitions: [
          {
            ...manifest.profile.fieldDefinitions[0],
            type: { type: 'list', itemType: 'boolean' },
          },
        ],
      },
    };

    expectIssue(invalid, 'invalid_literal', '$.profile.fieldDefinitions[0].type.itemType');
  });

  it('validates defaults against their declared field type', () => {
    const manifest = makeManifest();
    manifest.profile.fieldDefinitions[2].defaultValue = 'Earth';
    expectIssue(manifest, 'invalid_default_value', '$.profile.fieldDefinitions[2].defaultValue');
  });

  it('rejects mismatched, missing, and unknown attributes', () => {
    const wrongType = makeManifest();
    wrongType.cards[0].rootAttributes.attack = 'three';
    expectIssue(wrongType, 'invalid_field_value', '$.cards[0].rootAttributes.attack');

    const nonFinite = makeManifest();
    nonFinite.cards[0].rootAttributes.attack = Number.POSITIVE_INFINITY;
    expectIssue(nonFinite, 'invalid_field_value', '$.cards[0].rootAttributes.attack');

    const missingRequired = makeManifest();
    delete missingRequired.cards[0].rootAttributes.attack;
    expectIssue(missingRequired, 'missing_required_field', '$.cards[0].rootAttributes.attack');

    const unknownField = makeManifest();
    unknownField.cards[0].rootAttributes.rage = 2;
    expectIssue(unknownField, 'unknown_field', '$.cards[0].rootAttributes.rage');

    const wrongTarget = makeManifest();
    wrongTarget.cards[0].rootAttributes.faction = 'Fire';
    expectIssue(wrongTarget, 'unknown_field', '$.cards[0].rootAttributes.faction');
  });

  it('rejects enum and list values that do not match the field declaration', () => {
    const badEnum = makeManifest();
    badEnum.cards[0].faces[0].faceAttributes.faction = 'Earth';
    expectIssue(badEnum, 'invalid_field_value', '$.cards[0].faces[0].faceAttributes.faction');

    const badList = makeManifest();
    badList.cards[0].faces[0].faceAttributes.keywords = ['Flying', 7];
    expectIssue(badList, 'invalid_field_value', '$.cards[0].faces[0].faceAttributes.keywords[1]');
  });

  it('rejects non-ISO and impossible calendar dates', () => {
    const impossible = makeManifest();
    impossible.createdAt = '2026-02-30T00:00:00Z';
    expectIssue(impossible, 'invalid_literal', '$.createdAt');

    const nonIso = makeManifest();
    nonIso.packs[0].releaseDate = '01/01/2026';
    expectIssue(nonIso, 'invalid_literal', '$.packs[0].releaseDate');
  });
});

describe('references and duplicate IDs', () => {
  it('validates face identity and effective-type field scope', () => {
    const manifest = makeManifest();
    manifest.profile.fieldDefinitions.push({
      key: 'spellCost',
      label: 'Spell cost',
      type: { type: 'number' },
      target: 'face',
      cardTypes: ['Spell'],
    });
    const face = manifest.cards[0].faces[0];
    face.cardType = 'Spell';
    face.subtypes = ['Goblin'];
    face.faceAttributes.spellCost = 2;

    expect(validateProjectManifest(manifest).ok).toBe(true);

    const invalidScope = structuredClone(manifest);
    invalidScope.cards[0].faces[0].cardType = 'Creature';
    const scopeResult = validateProjectManifest(invalidScope);
    expect(scopeResult.ok).toBe(false);
    if (!scopeResult.ok) {
      expect(scopeResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unknown_field',
            path: '$.cards[0].faces[0].faceAttributes.spellCost',
          }),
        ]),
      );
    }

    const undeclaredType = structuredClone(manifest);
    undeclaredType.cards[0].faces[0].cardType = 'Land';
    expectIssue(
      undeclaredType,
      'invalid_reference',
      '$.cards[0].faces[0].cardType',
    );

    const undeclaredSubtype = structuredClone(manifest);
    undeclaredSubtype.cards[0].faces[0].subtypes = ['Angel'];
    expectIssue(
      undeclaredSubtype,
      'invalid_reference',
      '$.cards[0].faces[0].subtypes[0]',
    );
  });

  it('validates full-card image references like artwork', () => {
    const valid = makeManifest();
    valid.cards[0].faces[0].fullCardAssetId = ASSET_A;
    expect(validateProjectManifest(valid).ok).toBe(true);

    const missing = makeManifest();
    missing.cards[0].faces[0].fullCardAssetId = ASSET_B;
    expectIssue(
      missing,
      'unresolved_reference',
      '$.cards[0].faces[0].fullCardAssetId',
    );

    const malformed = makeManifest();
    malformed.cards[0].faces[0].fullCardAssetId = 'not-a-hash';
    expectIssue(
      malformed,
      'invalid_content_hash',
      '$.cards[0].faces[0].fullCardAssetId',
    );
  });

  it('rejects dangling profile, template, type, and subtype references', () => {
    const badProfile = makeManifest();
    badProfile.cards[0].profileId = 'other-profile';
    expectIssue(badProfile, 'unresolved_reference', '$.cards[0].profileId');

    const badTemplate = makeManifest();
    badTemplate.cards[0].templateId = 'missing-template';
    expectIssue(badTemplate, 'unresolved_reference', '$.cards[0].templateId');

    const badType = makeManifest();
    badType.cards[0].cardType = 'Land';
    expectIssue(badType, 'invalid_reference', '$.cards[0].cardType');

    const badSubtype = makeManifest();
    badSubtype.cards[0].subtypes = ['Angel'];
    expectIssue(badSubtype, 'invalid_reference', '$.cards[0].subtypes[0]');
  });

  it('rejects dangling pack and deck card references', () => {
    const badPack = makeManifest();
    badPack.packs[0].cardIds = ['missing-card'];
    expectIssue(badPack, 'unresolved_reference', '$.packs[0].cardIds[0]');

    const badDeck = makeManifest();
    badDeck.decks[0].entries[0].cardId = 'missing-card';
    expectIssue(badDeck, 'unresolved_reference', '$.decks[0].entries[0].cardId');
  });

  it('rejects duplicate deck entries and invalid counts', () => {
    const duplicateEntry = makeManifest();
    duplicateEntry.decks[0].entries.push({ cardId: 'card-1', count: 1 });
    expectIssue(duplicateEntry, 'duplicate_value', '$.decks[0].entries[1].cardId');

    const zeroCount = makeManifest();
    zeroCount.decks[0].entries[0].count = 0;
    expectIssue(zeroCount, 'out_of_range', '$.decks[0].entries[0].count');
  });

  it('rejects duplicate IDs in every collection', () => {
    const duplicateTemplate = makeManifest();
    duplicateTemplate.templates.push(structuredClone(duplicateTemplate.templates[0]));
    expectIssue(duplicateTemplate, 'duplicate_id', '$.templates[1].id');

    const duplicateCard = makeManifest();
    duplicateCard.cards.push(structuredClone(duplicateCard.cards[0]));
    expectIssue(duplicateCard, 'duplicate_id', '$.cards[1].id');

    const duplicatePack = makeManifest();
    duplicatePack.packs.push(structuredClone(duplicatePack.packs[0]));
    expectIssue(duplicatePack, 'duplicate_id', '$.packs[1].id');

    const duplicateDeck = makeManifest();
    duplicateDeck.decks.push(structuredClone(duplicateDeck.decks[0]));
    expectIssue(duplicateDeck, 'duplicate_id', '$.decks[1].id');

    const duplicateAsset = makeManifest();
    duplicateAsset.assets.push(structuredClone(duplicateAsset.assets[0]));
    expectIssue(duplicateAsset, 'duplicate_id', '$.assets[1].assetId');

    const duplicateField = makeManifest();
    duplicateField.profile.fieldDefinitions.push({
      ...structuredClone(duplicateField.profile.fieldDefinitions[0]),
      label: 'Duplicate Attack',
    });
    expectIssue(duplicateField, 'duplicate_id', '$.profile.fieldDefinitions[4].key');

    const duplicateFace = makeManifest();
    duplicateFace.cards[0].faces.push(structuredClone(duplicateFace.cards[0].faces[0]));
    expectIssue(duplicateFace, 'duplicate_id', '$.cards[0].faces[1].faceId');

    const duplicateBlock = makeManifest();
    duplicateBlock.templates[0].blocks.push(
      structuredClone(duplicateBlock.templates[0].blocks[0]),
    );
    expectIssue(duplicateBlock, 'duplicate_id', '$.templates[0].blocks[3].id');
  });

  it('rejects duplicate profile-level field keys', () => {
    const manifest = makeManifest();
    manifest.profile.fieldDefinitions.push({
      ...structuredClone(manifest.profile.fieldDefinitions[0]),
      label: 'Copy',
    });
    expectIssue(manifest, 'duplicate_id', '$.profile.fieldDefinitions[4].key');
  });

  it('rejects malformed and dangling artwork references', () => {
    const malformedFaceHash = makeManifest();
    malformedFaceHash.cards[0].faces[0].artAssetId = 'not-a-hash';
    expectIssue(
      malformedFaceHash,
      'invalid_content_hash',
      '$.cards[0].faces[0].artAssetId',
    );

    const malformedAssetHash = makeManifest();
    malformedAssetHash.assets[0].assetId = 'not-a-hash';
    expectIssue(malformedAssetHash, 'invalid_content_hash', '$.assets[0].assetId');

    const danglingArtwork = makeManifest();
    danglingArtwork.cards[0].faces[0].artAssetId = ASSET_B;
    expectIssue(
      danglingArtwork,
      'unresolved_reference',
      '$.cards[0].faces[0].artAssetId',
    );
  });
});

describe('structured field validation', () => {
  it('validates child keys, required values, options, and entry ids', () => {
    const manifest = makeManifest();
    manifest.profile.fieldDefinitions.push({
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
            required: true,
            defaultValue: 'Generic',
          },
          {
            key: 'amount',
            label: 'Amount',
            type: { type: 'number' },
            required: true,
            defaultValue: 1,
          },
        ],
      },
    });
    manifest.cards[0].faces[0].faceAttributes.cost = [
      { entryId: 'cost-1', values: { resource: 'Red', amount: 2 } },
    ];

    expect(validateProjectManifest(manifest).ok).toBe(true);

    const invalidOption = structuredClone(manifest);
    invalidOption.cards[0].faces[0].faceAttributes.cost = [
      { entryId: 'cost-1', values: { resource: 'Blue', amount: 2 } },
    ];
    expectIssue(
      invalidOption,
      'invalid_field_value',
      '$.cards[0].faces[0].faceAttributes.cost[0].values.resource',
    );

    const missingRequired = structuredClone(manifest);
    missingRequired.cards[0].faces[0].faceAttributes.cost = [
      { entryId: 'cost-1', values: { resource: 'Red' } },
    ];
    expectIssue(
      missingRequired,
      'invalid_field_value',
      '$.cards[0].faces[0].faceAttributes.cost[0].values.amount',
    );

    const unknownChild = structuredClone(manifest);
    unknownChild.cards[0].faces[0].faceAttributes.cost = [
      {
        entryId: 'cost-1',
        values: { resource: 'Red', amount: 2, extra: true },
      },
    ];
    expectIssue(
      unknownChild,
      'unknown_field',
      '$.cards[0].faces[0].faceAttributes.cost[0].values.extra',
    );

    const duplicateEntry = structuredClone(manifest);
    duplicateEntry.cards[0].faces[0].faceAttributes.cost = [
      { entryId: 'cost-1', values: { resource: 'Red', amount: 2 } },
      { entryId: 'cost-1', values: { resource: 'Generic', amount: 1 } },
    ];
    expectIssue(
      duplicateEntry,
      'duplicate_id',
      '$.cards[0].faces[0].faceAttributes.cost[1].entryId',
    );
  });

  it('allows bounded nested structured children and rejects invalid defaults', () => {
    const nestedLevels: FieldDefinition = {
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
            required: true,
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
                  type: { type: 'enum', options: ['Generic', 'Red'] },
                  required: true,
                },
                {
                  key: 'amount',
                  label: 'Amount',
                  type: { type: 'number' },
                  required: true,
                },
              ],
            },
          },
          {
            key: 'power',
            label: 'Power',
            type: { type: 'number' },
            required: true,
          },
        ],
      },
    };

    expect(validateFieldDefinition(nestedLevels)).toEqual([]);
    expect(
      validateFieldValue(nestedLevels, [
        {
          entryId: 'level-1',
          values: {
            level: 1,
            power: 4000,
            energy: [
              {
                entryId: 'energy-1',
                values: { resource: 'Red', amount: 2 },
              },
            ],
          },
        },
      ]),
    ).toEqual([]);

    const tooDeep: unknown = {
      key: 'deep',
      label: 'Deep',
      target: 'face',
      type: {
        type: 'structured',
        children: [
          {
            key: 'a',
            label: 'A',
            type: {
              type: 'structured',
              children: [
                {
                  key: 'b',
                  label: 'B',
                  type: {
                    type: 'structured',
                    children: [
                      {
                        key: 'c',
                        label: 'C',
                        type: {
                          type: 'structured',
                          children: [
                            { key: 'd', label: 'D', type: { type: 'text' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    };

    expect(validateFieldDefinition(tooDeep)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_literal' }),
      ]),
    );

    const badDefault: unknown = {
      key: 'cost',
      label: 'Cost',
      target: 'face',
      type: {
        type: 'structured',
        children: [
          {
            key: 'resource',
            label: 'Resource',
            type: { type: 'enum', options: ['Generic'] },
            defaultValue: 'Red',
          },
        ],
      },
    };

    expect(validateFieldDefinition(badDefault)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_default_value',
          path: '$.type.children[0].defaultValue',
        }),
      ]),
    );
  });
});

describe('template safety', () => {
  it('validates hideWhenEmpty as an optional boolean', () => {
    const valid = makeManifest();
    valid.templates[0].blocks[0].hideWhenEmpty = true;
    expect(validateProjectManifest(valid).ok).toBe(true);

    const invalid = makeManifest();
    const block = invalid.templates[0].blocks[0] as unknown as Record<
      string,
      unknown
    >;
    block.hideWhenEmpty = 'yes';
    expectIssue(
      invalid,
      'expected_boolean',
      '$.templates[0].blocks[0].hideWhenEmpty',
    );
  });

  it('rejects unknown block types', () => {
    const manifest = makeManifest();
    const invalid: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: [{ ...manifest.templates[0].blocks[0], type: 'carousel' }],
        },
      ],
    };

    expectIssue(invalid, 'invalid_literal', '$.templates[0].blocks[0].type');
  });

  it('rejects raw Tailwind class strings and unknown token IDs', () => {
    const manifest = makeManifest();

    const rawClass: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: [
            {
              ...manifest.templates[0].blocks[0],
              designTokenStyle: 'bg-amber-900/10 border-amber-800',
            },
          ],
        },
      ],
    };
    expectIssue(
      rawClass,
      'invalid_literal',
      '$.templates[0].blocks[0].designTokenStyle',
    );

    const unknownToken: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: [
            {
              ...manifest.templates[0].blocks[0],
              designTokenStyle: 'header.neon',
            },
          ],
        },
      ],
    };
    expectIssue(
      unknownToken,
      'invalid_literal',
      '$.templates[0].blocks[0].designTokenStyle',
    );
  });

  it('rejects mapping keys that resolve to neither a core target nor a field', () => {
    const manifest = makeManifest();
    const invalid: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: [
            {
              ...manifest.templates[0].blocks[0],
              mappingKey: 'notACoreOrFieldKey',
            },
          ],
        },
      ],
    };

    expectIssue(
      invalid,
      'invalid_reference',
      '$.templates[0].blocks[0].mappingKey',
    );
  });

  it('rejects mappings that are incompatible with the block role', () => {
    const manifest = makeManifest();
    expect(validateProjectManifest(manifest).ok).toBe(true);

    const artToNumber: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: manifest.templates[0].blocks.map((block, index) =>
            index === 1 ? { ...block, mappingKey: 'attack' } : block,
          ),
        },
      ],
    };
    expectIssue(
      artToNumber,
      'invalid_reference',
      '$.templates[0].blocks[1].mappingKey',
    );

    const statToCore: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: manifest.templates[0].blocks.map((block, index) =>
            index === 2 ? { ...block, mappingKey: 'name' } : block,
          ),
        },
      ],
    };
    expectIssue(
      statToCore,
      'invalid_reference',
      '$.templates[0].blocks[2].mappingKey',
    );

    const splitterMapping: unknown = {
      ...manifest,
      templates: [
        {
          ...manifest.templates[0],
          blocks: [
            {
              id: 'b1',
              type: 'splitter',
              designTokenStyle: 'splitter.default',
              mappingKey: 'name',
              order: 0,
            },
          ],
        },
      ],
    };
    expectIssue(
      splitterMapping,
      'invalid_reference',
      '$.templates[0].blocks[0].mappingKey',
    );
  });
});

describe('asset byte verification', () => {
  const HELLO_HASH =
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const helloBytes = new TextEncoder().encode('hello');

  function makeHelloReference() {
    return {
      assetId: HELLO_HASH,
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      byteSize: helloBytes.byteLength,
    };
  }

  it('computes lowercase SHA-256 digests for views and buffers', async () => {
    await expect(computeSha256Hex(helloBytes)).resolves.toBe(HELLO_HASH);
    await expect(computeSha256Hex(helloBytes.slice().buffer)).resolves.toBe(
      HELLO_HASH,
    );
  });

  it('hashes only the bytes inside a subarray view', async () => {
    const backing = new TextEncoder().encode('xxhelloxx');
    const view = backing.subarray(2, 7);

    await expect(computeSha256Hex(view)).resolves.toBe(HELLO_HASH);
  });

  it('accepts bytes that match the reference hash and size', async () => {
    const result = await validateAssetBytes(makeHelloReference(), helloBytes);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assetId).toBe(HELLO_HASH);
      expect(result.value.byteSize).toBe(helloBytes.byteLength);
    }
  });

  it('rejects bytes whose hash does not match the reference', async () => {
    const result = await validateAssetBytes(
      { ...makeHelloReference(), assetId: '0'.repeat(64) },
      helloBytes,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'content_hash_mismatch',
            path: '$.assetId',
          }),
        ]),
      );
    }
  });

  it('rejects bytes whose length does not match the reference', async () => {
    const result = await validateAssetBytes(
      { ...makeHelloReference(), byteSize: 6 },
      helloBytes,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'byte_size_mismatch',
            path: '$.byteSize',
          }),
        ]),
      );
    }
  });

  it('rejects malformed references and non-binary payloads', async () => {
    const malformedReference = await validateAssetBytes(
      { ...makeHelloReference(), assetId: 'not-a-hash' },
      helloBytes,
    );
    expect(malformedReference.ok).toBe(false);
    if (!malformedReference.ok) {
      expect(malformedReference.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_content_hash',
            path: '$.assetId',
          }),
        ]),
      );
    }

    const nonBinary = await validateAssetBytes(
      makeHelloReference(),
      'hello',
    );
    expect(nonBinary.ok).toBe(false);
    if (!nonBinary.ok) {
      expect(nonBinary.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'expected_binary_data',
            path: '$.bytes',
          }),
        ]),
      );
    }
  });
});

describe('migration', () => {
  it('marks v0 as requiring migration until it is upgraded', () => {
    expectIssue(makeLegacyManifest(), 'migration_required', '$.schemaVersion');
  });

  it('migrates a valid v0 manifest without mutating the input', () => {
    const legacy = makeLegacyManifest();
    const snapshot = structuredClone(legacy);

    const result = migrateProjectManifest(legacy);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.schemaVersion).toBe(2);
      expect(result.value.assets).toEqual(legacy.assets);
      expect(result.value.packs).toEqual([]);
      expect(result.value.cards[0].subtypes).toEqual([]);
      expect(result.value.cards[0].tags).toEqual([]);
      expect(result.value.decks[0].tags).toEqual([]);
    }

    expect(legacy).toEqual(snapshot);
  });

  it('migrates an additive v1 manifest to v2 without changing data', () => {
    const v1: Record<string, unknown> = {
      ...structuredClone(makeManifest()),
      schemaVersion: 1,
    };

    const result = migrateProjectManifest(v1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schemaVersion).toBe(2);
      expect(result.value.cards).toEqual(makeManifest().cards);
    }
  });

  it('does not coerce present-but-malformed v0 properties', () => {
    const legacy = makeLegacyManifest();
    const withoutAssets: Record<string, unknown> = { ...legacy };
    delete withoutAssets.assets;

    const cases: ReadonlyArray<readonly [unknown, ValidationIssueCode, string]> = [
      [{ ...legacy, assets: 'broken' }, 'expected_array', '$.assets'],
      [withoutAssets, 'missing_property', '$.assets'],
      [{ ...legacy, packs: 'broken' }, 'expected_array', '$.packs'],
      [
        { ...legacy, cards: [{ ...legacy.cards[0], subtypes: 'Dragon' }] },
        'expected_array',
        '$.cards[0].subtypes',
      ],
      [
        { ...legacy, cards: [{ ...legacy.cards[0], tags: 'starter' }] },
        'expected_array',
        '$.cards[0].tags',
      ],
      [
        { ...legacy, decks: [{ ...legacy.decks[0], tags: 'aggro' }] },
        'expected_array',
        '$.decks[0].tags',
      ],
    ];

    for (const [data, code, path] of cases) {
      const result = migrateProjectManifest(data);
      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code, path })]),
        );
      }
    }
  });

  it('rejects unsupported, too-old, and non-integer versions', () => {
    expectIssue({ ...makeManifest(), schemaVersion: 3 }, 'unsupported_version', '$.schemaVersion');
    expectIssue({ ...makeManifest(), schemaVersion: -1 }, 'invalid_version', '$.schemaVersion');
    expectIssue({ ...makeManifest(), schemaVersion: 1.5 }, 'invalid_version', '$.schemaVersion');

    const future = migrateProjectManifest({ ...makeManifest(), schemaVersion: 3 });
    expect(future.ok).toBe(false);
    if (!future.ok) {
      expect(future.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported_version', path: '$.schemaVersion' }),
        ]),
      );
    }

    const tooOld = migrateProjectManifest({ ...makeManifest(), schemaVersion: -1 });
    expect(tooOld.ok).toBe(false);
    if (!tooOld.ok) {
      expect(tooOld.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid_version', path: '$.schemaVersion' }),
        ]),
      );
    }
  });
});

function makeIncomingWithUniqueIds(): ProjectManifest {
  const manifest = makeManifest();

  manifest.projectId = 'proj-2';
  manifest.profile = {
    ...manifest.profile,
    id: 'profile-2',
    name: 'Incoming Profile',
  };
  manifest.templates = manifest.templates.map((template) => ({
    ...template,
    id: 'tpl-2',
    profileId: 'profile-2',
    name: 'Incoming Template',
  }));
  manifest.cards = manifest.cards.map((card) => ({
    ...card,
    id: 'card-2',
    profileId: 'profile-2',
    templateId: 'tpl-2',
    name: 'Incoming Card',
  }));
  manifest.packs = manifest.packs.map((pack) => ({
    ...pack,
    id: 'pack-2',
    name: 'Incoming Pack',
    cardIds: ['card-2'],
  }));
  manifest.decks = manifest.decks.map((deck) => ({
    ...deck,
    id: 'deck-2',
    profileId: 'profile-2',
    name: 'Incoming Deck',
    entries: [{ cardId: 'card-2', count: 2 }],
  }));

  return manifest;
}

describe('import preview', () => {
  it('reports same-ID collisions for mutable entities', () => {
    const existing = makeManifest();
    const incoming = makeIncomingWithUniqueIds();

    incoming.templates[0].id = 'tpl-1';
    incoming.cards[0].templateId = 'tpl-1';
    incoming.cards[0].id = 'card-1';
    incoming.packs[0].id = 'pack-1';
    incoming.packs[0].cardIds = ['card-1'];
    incoming.decks[0].id = 'deck-1';
    incoming.decks[0].entries = [{ cardId: 'card-1', count: 2 }];

    const analysis = analyzeProjectImport(incoming, existing);
    expect(analysis.ok).toBe(true);
    expect(analysis.migrated).toBe(false);
    expect(analysis.fromSchemaVersion).toBe(2);
    expect(
      analysis.collisions.map((collision) => collision.kind).sort(),
    ).toEqual(['card', 'deck', 'pack', 'template']);
    expect(
      analysis.collisions.every((collision) => collision.reason === 'same_entity_id'),
    ).toBe(true);
  });

  it('reports a profile ID collision as an update decision', () => {
    const existing = makeManifest();
    const incoming = makeIncomingWithUniqueIds();

    incoming.profile = { ...incoming.profile, id: 'profile-1' };
    incoming.templates[0].profileId = 'profile-1';
    incoming.cards[0].profileId = 'profile-1';
    incoming.decks[0].profileId = 'profile-1';

    const collisions = detectIdCollisions(incoming, existing);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].kind).toBe('profile');
    expect(collisions[0].reason).toBe('same_entity_id');
  });

  it('ignores matching content-addressed assets with different hints', () => {
    const existing = makeManifest();
    const incoming = makeIncomingWithUniqueIds();
    incoming.assets[0].fileName = 'renamed.png';
    incoming.assets[0].relativePathHint = 'other/renamed.png';

    expect(detectIdCollisions(incoming, existing)).toEqual([]);
  });

  it('reports asset metadata conflicts for matching content hashes', () => {
    const existing = makeManifest();
    const incoming = makeIncomingWithUniqueIds();
    incoming.assets[0].mimeType = 'image/jpeg';
    incoming.assets[0].byteSize = 2048;

    const collisions = detectIdCollisions(incoming, existing);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      kind: 'asset',
      id: ASSET_A,
      reason: 'asset_metadata_mismatch',
    });
    expect(collisions[0].detail).toContain('mimeType');
    expect(collisions[0].detail).toContain('byteSize');
  });

  it('analyzes a v0 import through the migration pipeline', () => {
    const analysis = analyzeProjectImport(makeLegacyManifest());

    expect(analysis.ok).toBe(true);
    expect(analysis.migrated).toBe(true);
    expect(analysis.fromSchemaVersion).toBe(0);
    expect(analysis.collisions).toEqual([]);
  });
});

describe('robustness', () => {
  it('returns parse_error for malformed JSON', () => {
    const result = parseProjectManifestJson('{');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'parse_error', path: '$' }),
      ]);
    }
  });

  it('parses and validates JSON through the migration pipeline', () => {
    const result = parseProjectManifestJson(JSON.stringify(makeManifest()));
    expect(result.ok).toBe(true);
  });

  it('rejects payloads over the configured import size limit', () => {
    const result = parseProjectManifestJson(JSON.stringify(makeManifest()), {
      maxBytes: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'manifest_too_large', path: '$' }),
      ]);
    }
  });

  it('reports nested malformed values without throwing', () => {
    const malformed: unknown = {
      schemaVersion: 1,
      projectId: 'proj',
      projectName: 'Project',
      profile: null,
      templates: [null, 42],
      cards: [null],
      packs: 'nope',
      decks: [null],
      assets: [null],
    };

    const result = validateProjectManifest(malformed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '$.templates[0]', code: 'expected_object' }),
          expect.objectContaining({ path: '$.cards[0]', code: 'expected_object' }),
          expect.objectContaining({ path: '$.packs', code: 'expected_array' }),
        ]),
      );
    }
  });

  it('validates individual field definitions and values', () => {
    expect(
      validateFieldDefinition({
        key: 'cost',
        label: 'Cost',
        type: { type: 'number' },
        target: 'root',
      }),
    ).toEqual([]);

    expect(
      validateFieldDefinition({
        key: 'cost',
        label: 'Cost',
        type: { type: 'enum', options: [] },
        target: 'root',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_literal', path: '$.type.options' }),
      ]),
    );

    const enumField: FieldDefinition = {
      key: 'faction',
      label: 'Faction',
      type: { type: 'enum', options: ['Fire', 'Water'] },
      target: 'face',
    };

    expect(validateFieldValue(enumField, 'Fire')).toEqual([]);
    expect(validateFieldValue(enumField, 'Earth')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_field_value', path: '$' }),
      ]),
    );

    const listField: FieldDefinition = {
      key: 'keywords',
      label: 'Keywords',
      type: { type: 'list', itemType: 'number' },
      target: 'face',
    };

    expect(validateFieldValue(listField, ['Flying'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_field_value', path: '$[0]' }),
      ]),
    );
  });
});
