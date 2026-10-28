import { describe, expect, it } from 'vitest';

import { DEFAULT_CARD_TEMPLATE_ID } from '../cards/cardModel';
import type { CardRecord } from '../types/CardRecord';
import type { GameProfile } from '../types/Game';
import type { ProjectManifest } from '../types/ProjectManifest';
import {
  applyProfileToProject,
  clearProjectCards,
  createCardTemplateDraft,
  createDeckDraft,
  createDefaultCardTemplate,
  createPackDraft,
  createProjectManifest,
  createTemplateBlock,
  mergeProjectManifests,
  removeProjectCard,
  removeProjectDeck,
  removeProjectPack,
  removeProjectTemplate,
  upsertProjectCard,
  upsertProjectDeck,
  upsertProjectPack,
  upsertProjectTemplate,
  validateStoredProject,
} from './projectModel';

function makeProfile(): GameProfile {
  return {
    id: 'profile-1',
    name: 'Test Game',
    cardTypes: ['Creature', 'Spell'],
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

function makeCard(profile: GameProfile, id = 'card-1'): CardRecord {
  return {
    id,
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

function makeProject(): ProjectManifest {
  const profile = makeProfile();
  const project = createProjectManifest(profile);
  return upsertProjectCard(project, makeCard(profile));
}

describe('project model', () => {
  it('creates a project with a real default template', () => {
    const profile = makeProfile();
    const project = createProjectManifest(profile);

    expect(project.profile).toEqual(profile);
    expect(project.templates).toHaveLength(1);
    expect(project.templates[0]).toMatchObject({
      id: DEFAULT_CARD_TEMPLATE_ID,
      profileId: profile.id,
      layout: 'single',
    });
    expect(project.templates[0].blocks.map((block) => block.type)).toEqual([
      'header',
      'art_box',
      'textbox',
      'tag_list',
    ]);
    expect(project.cards).toEqual([]);
    expect(project.packs).toEqual([]);
    expect(project.decks).toEqual([]);
    expect(project.assets).toEqual([]);
    expect(validateStoredProject(project).ok).toBe(true);
  });

  it('keeps templates aligned when the profile changes', () => {
    const project = makeProject();
    const nextProfile = {
      ...structuredClone(project.profile),
      name: 'Updated Game',
    };
    const updated = applyProfileToProject(project, nextProfile);

    expect(updated.profile.name).toBe('Updated Game');
    expect(updated.templates[0].profileId).toBe(nextProfile.id);
    expect(updated.cards).toEqual(project.cards);
  });

  it('adds, replaces, removes, and clears cards', () => {
    const profile = makeProfile();
    const base = createProjectManifest(profile);
    const first = makeCard(profile, 'card-1');
    const second = makeCard(profile, 'card-2');

    const withFirst = upsertProjectCard(base, first);
    const withBoth = upsertProjectCard(withFirst, second);
    expect(withBoth.cards.map((card) => card.id)).toEqual([
      'card-1',
      'card-2',
    ]);

    const renamed = { ...structuredClone(first), name: 'Renamed' };
    const replaced = upsertProjectCard(withBoth, renamed);
    expect(replaced.cards).toHaveLength(2);
    expect(
      replaced.cards.find((card) => card.id === 'card-1')?.name,
    ).toBe('Renamed');

    expect(removeProjectCard(replaced, 'card-1').cards.map((card) => card.id)).toEqual([
      'card-2',
    ]);
    expect(clearProjectCards(replaced).cards).toEqual([]);
  });

  it('validates card ownership, template references, and unique IDs', () => {
    const project = makeProject();

    const duplicate = structuredClone(project);
    duplicate.cards.push(structuredClone(duplicate.cards[0]));
    const duplicateResult = validateStoredProject(duplicate);
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

    const foreign = structuredClone(project);
    foreign.cards[0].profileId = 'profile-2';
    const foreignResult = validateStoredProject(foreign);
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

    const unknownTemplate = structuredClone(project);
    unknownTemplate.cards[0].templateId = 'missing-template';
    const templateResult = validateStoredProject(unknownTemplate);
    expect(templateResult.ok).toBe(false);
    if (!templateResult.ok) {
      expect(templateResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unresolved_reference',
            path: '$.cards[0].templateId',
          }),
        ]),
      );
    }
  });

  it('allows orphaned card attributes in internal persistence', () => {
    const project = makeProject();
    project.cards[0].rootAttributes.rage = 2;

    expect(validateStoredProject(project).ok).toBe(true);
  });

  it('accepts well-formed packs, decks, and assets', () => {
    const project = makeProject();
    const assetId = 'a'.repeat(64);

    project.assets = [
      {
        assetId,
        fileName: 'dragon.png',
        mimeType: 'image/png',
        byteSize: 2048,
      },
    ];
    project.cards[0].faces[0].artAssetId = assetId;
    project.packs = [
      {
        id: 'pack-1',
        name: 'Starter Set',
        description: 'First release',
        cardIds: ['card-1'],
      },
    ];
    project.decks = [
      {
        id: 'deck-1',
        profileId: project.profile.id,
        name: 'Main deck',
        format: 'Standard',
        entries: [{ cardId: 'card-1', count: 2 }],
        tags: ['aggro'],
      },
    ];

    const result = validateStoredProject(project);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.packs).toHaveLength(1);
      expect(result.value.decks).toHaveLength(1);
      expect(result.value.assets).toHaveLength(1);
    }
  });

  it('rejects malformed packs, duplicate pack IDs, and dangling card references', () => {
    const malformed = structuredClone(makeProject()) as unknown as Record<
      string,
      unknown
    >;
    malformed.packs = [{ id: 'pack-1', description: '', cardIds: [] }];
    const malformedResult = validateStoredProject(malformed);
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'missing_property',
            path: '$.packs[0].name',
          }),
        ]),
      );
    }

    const dangling = structuredClone(makeProject());
    dangling.packs = [
      {
        id: 'pack-1',
        name: 'Starter Set',
        description: '',
        cardIds: ['missing-card'],
      },
    ];
    const danglingResult = validateStoredProject(dangling);
    expect(danglingResult.ok).toBe(false);
    if (!danglingResult.ok) {
      expect(danglingResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unresolved_reference',
            path: '$.packs[0].cardIds[0]',
          }),
        ]),
      );
    }

    const duplicate = structuredClone(makeProject());
    duplicate.packs = [
      {
        id: 'pack-1',
        name: 'Starter Set',
        description: '',
        cardIds: [],
      },
      {
        id: 'pack-1',
        name: 'Second Set',
        description: '',
        cardIds: [],
      },
    ];
    const duplicateResult = validateStoredProject(duplicate);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'duplicate_id',
            path: '$.packs[1].id',
          }),
        ]),
      );
    }
  });

  it('rejects malformed decks, foreign profiles, and dangling entries', () => {
    const project = makeProject();
    const baseDeck = {
      id: 'deck-1',
      profileId: project.profile.id,
      name: 'Main deck',
      format: 'Standard',
      entries: [{ cardId: 'card-1', count: 2 }],
      tags: ['aggro'],
    };

    const malformed = structuredClone(project) as unknown as Record<
      string,
      unknown
    >;
    malformed.decks = [{ ...baseDeck, entries: [{ cardId: 'card-1', count: 0 }] }];
    const malformedResult = validateStoredProject(malformed);
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'out_of_range',
            path: '$.decks[0].entries[0].count',
          }),
        ]),
      );
    }

    const foreign = structuredClone(project);
    foreign.decks = [{ ...baseDeck, profileId: 'profile-2' }];
    const foreignResult = validateStoredProject(foreign);
    expect(foreignResult.ok).toBe(false);
    if (!foreignResult.ok) {
      expect(foreignResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unresolved_reference',
            path: '$.decks[0].profileId',
          }),
        ]),
      );
    }

    const dangling = structuredClone(project);
    dangling.decks = [
      { ...baseDeck, entries: [{ cardId: 'missing-card', count: 1 }] },
    ];
    const danglingResult = validateStoredProject(dangling);
    expect(danglingResult.ok).toBe(false);
    if (!danglingResult.ok) {
      expect(danglingResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unresolved_reference',
            path: '$.decks[0].entries[0].cardId',
          }),
        ]),
      );
    }
  });

  it('rejects malformed assets and duplicate asset IDs', () => {
    const malformed = structuredClone(makeProject());
    malformed.assets = [
      {
        assetId: 'not-a-hash',
        fileName: 'dragon.png',
        mimeType: 'image/png',
        byteSize: 2048,
      },
    ];
    const malformedResult = validateStoredProject(malformed);
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_content_hash',
            path: '$.assets[0].assetId',
          }),
        ]),
      );
    }

    const negativeSize = structuredClone(makeProject());
    negativeSize.assets = [
      {
        assetId: 'a'.repeat(64),
        fileName: 'dragon.png',
        mimeType: 'image/png',
        byteSize: -1,
      },
    ];
    const negativeResult = validateStoredProject(negativeSize);
    expect(negativeResult.ok).toBe(false);
    if (!negativeResult.ok) {
      expect(negativeResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'out_of_range',
            path: '$.assets[0].byteSize',
          }),
        ]),
      );
    }

    const duplicate = structuredClone(makeProject());
    const asset = {
      assetId: 'b'.repeat(64),
      fileName: 'dragon.png',
      mimeType: 'image/png',
      byteSize: 2048,
    };
    duplicate.assets = [asset, { ...asset, fileName: 'copy.png' }];
    const duplicateResult = validateStoredProject(duplicate);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'duplicate_id',
            path: '$.assets[1].assetId',
          }),
        ]),
      );
    }
  });

  it('rejects card artwork without a matching asset reference', () => {
    const missing = structuredClone(makeProject());
    missing.cards[0].faces[0].artAssetId = 'c'.repeat(64);
    const missingResult = validateStoredProject(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unresolved_reference',
            path: '$.cards[0].faces[0].artAssetId',
          }),
        ]),
      );
    }

    const malformed = structuredClone(makeProject());
    malformed.cards[0].faces[0].artAssetId = 'not-a-hash';
    const malformedResult = validateStoredProject(malformed);
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_content_hash',
            path: '$.cards[0].faces[0].artAssetId',
          }),
        ]),
      );
    }
  });

  it('rejects unsupported template block types and raw design-token strings', () => {
    const unknownType = structuredClone(makeProject());
    const unknownTypeBlock = unknownType.templates[0]
      .blocks[0] as unknown as Record<string, unknown>;
    unknownTypeBlock.type = 'script_exec';

    const unknownTypeResult = validateStoredProject(unknownType);
    expect(unknownTypeResult.ok).toBe(false);
    if (!unknownTypeResult.ok) {
      expect(unknownTypeResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_literal',
            path: '$.templates[0].blocks[0].type',
          }),
        ]),
      );
    }

    const rawToken = structuredClone(makeProject());
    const rawTokenBlock = rawToken.templates[0]
      .blocks[0] as unknown as Record<string, unknown>;
    rawTokenBlock.designTokenStyle = 'text-red-500';

    const rawTokenResult = validateStoredProject(rawToken);
    expect(rawTokenResult.ok).toBe(false);
    if (!rawTokenResult.ok) {
      expect(rawTokenResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_literal',
            path: '$.templates[0].blocks[0].designTokenStyle',
          }),
        ]),
      );
    }
  });

  it('rejects duplicate block IDs, invalid order, and invalid mappings', () => {
    const duplicateBlock = structuredClone(makeProject());
    duplicateBlock.templates[0].blocks[1].id =
      duplicateBlock.templates[0].blocks[0].id;

    const duplicateBlockResult = validateStoredProject(duplicateBlock);
    expect(duplicateBlockResult.ok).toBe(false);
    if (!duplicateBlockResult.ok) {
      expect(duplicateBlockResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'duplicate_id',
            path: '$.templates[0].blocks[1].id',
          }),
        ]),
      );
    }

    const fractionalOrder = structuredClone(makeProject());
    fractionalOrder.templates[0].blocks[0].order = 1.5;

    const fractionalOrderResult = validateStoredProject(fractionalOrder);
    expect(fractionalOrderResult.ok).toBe(false);
    if (!fractionalOrderResult.ok) {
      expect(fractionalOrderResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'expected_integer',
            path: '$.templates[0].blocks[0].order',
          }),
        ]),
      );
    }

    const negativeOrder = structuredClone(makeProject());
    negativeOrder.templates[0].blocks[0].order = -1;

    const negativeOrderResult = validateStoredProject(negativeOrder);
    expect(negativeOrderResult.ok).toBe(false);
    if (!negativeOrderResult.ok) {
      expect(negativeOrderResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'out_of_range',
            path: '$.templates[0].blocks[0].order',
          }),
        ]),
      );
    }

    const invalidMapping = structuredClone(makeProject());
    const invalidMappingBlock = invalidMapping.templates[0]
      .blocks[0] as unknown as Record<string, unknown>;
    invalidMappingBlock.mappingKey = 'notAField';

    const invalidMappingResult = validateStoredProject(invalidMapping);
    expect(invalidMappingResult.ok).toBe(false);
    if (!invalidMappingResult.ok) {
      expect(invalidMappingResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_reference',
            path: '$.templates[0].blocks[0].mappingKey',
          }),
        ]),
      );
    }
  });

  it('accepts compatible block mappings and rejects incompatible ones', () => {
    const compatible = structuredClone(makeProject());
    compatible.templates[0].blocks.push({
      id: 'block-stat',
      type: 'stat_badge',
      designTokenStyle: 'stat.primary',
      mappingKey: 'attack',
      order: 4,
    });
    expect(validateStoredProject(compatible).ok).toBe(true);

    const artToNumber = structuredClone(makeProject());
    artToNumber.templates[0].blocks[1].mappingKey = 'attack';
    const artToNumberResult = validateStoredProject(artToNumber);
    expect(artToNumberResult.ok).toBe(false);
    if (!artToNumberResult.ok) {
      expect(artToNumberResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_reference',
            path: '$.templates[0].blocks[1].mappingKey',
          }),
        ]),
      );
    }

    const statToCore = structuredClone(makeProject());
    statToCore.templates[0].blocks.push({
      id: 'block-stat',
      type: 'stat_badge',
      designTokenStyle: 'stat.primary',
      mappingKey: 'name',
      order: 4,
    });
    const statToCoreResult = validateStoredProject(statToCore);
    expect(statToCoreResult.ok).toBe(false);
    if (!statToCoreResult.ok) {
      expect(statToCoreResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_reference',
            path: '$.templates[0].blocks[4].mappingKey',
          }),
        ]),
      );
    }

    const splitterMapping = structuredClone(makeProject());
    splitterMapping.templates[0].blocks.push({
      id: 'block-splitter',
      type: 'splitter',
      designTokenStyle: 'splitter.default',
      mappingKey: 'name',
      order: 4,
    });
    const splitterMappingResult = validateStoredProject(splitterMapping);
    expect(splitterMappingResult.ok).toBe(false);
    if (!splitterMappingResult.ok) {
      expect(splitterMappingResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_reference',
            path: '$.templates[0].blocks[4].mappingKey',
          }),
        ]),
      );
    }
  });

  it('rejects invalid profiles and empty template lists', () => {
    const project = makeProject();
    project.profile.name = '';
    const profileResult = validateStoredProject(project);
    expect(profileResult.ok).toBe(false);
    if (!profileResult.ok) {
      expect(profileResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'empty_string',
            path: '$.profile.name',
          }),
        ]),
      );
    }

    const noTemplates = structuredClone(makeProject());
    noTemplates.templates = [];
    expect(validateStoredProject(noTemplates).ok).toBe(false);
  });

  it('removes card references from packs and decks when a card is deleted', () => {
    const project = makeProject();
    const withPack = upsertProjectPack(project, {
      id: 'pack-1',
      name: 'Starter',
      description: '',
      cardIds: ['card-1'],
    });
    const withDeck = upsertProjectDeck(withPack, {
      id: 'deck-1',
      profileId: project.profile.id,
      name: 'Main deck',
      format: 'Standard',
      entries: [{ cardId: 'card-1', count: 2 }],
      tags: [],
    });

    const removed = removeProjectCard(withDeck, 'card-1');

    expect(removed.cards).toEqual([]);
    expect(removed.packs[0].cardIds).toEqual([]);
    expect(removed.decks[0].entries).toEqual([]);
    expect(validateStoredProject(removed).ok).toBe(true);
  });

  it('clears pack and deck card references when all cards are cleared', () => {
    const project = makeProject();
    const withPack = upsertProjectPack(project, {
      id: 'pack-1',
      name: 'Starter',
      description: '',
      cardIds: ['card-1'],
    });
    const withDeck = upsertProjectDeck(withPack, {
      id: 'deck-1',
      profileId: project.profile.id,
      name: 'Main deck',
      format: 'Standard',
      entries: [{ cardId: 'card-1', count: 2 }],
      tags: [],
    });

    const cleared = clearProjectCards(withDeck);

    expect(cleared.cards).toEqual([]);
    expect(cleared.packs[0].cardIds).toEqual([]);
    expect(cleared.decks[0].entries).toEqual([]);
    expect(validateStoredProject(cleared).ok).toBe(true);
  });

  it('creates plain drafts for packs, decks, templates, and blocks', () => {
    const pack = createPackDraft();
    expect(pack.name).toBe('');
    expect(pack.cardIds).toEqual([]);

    const deck = createDeckDraft('profile-1');
    expect(deck.profileId).toBe('profile-1');
    expect(deck.entries).toEqual([]);

    const template = createCardTemplateDraft('profile-1');
    expect(template.profileId).toBe('profile-1');
    expect(template.blocks).toEqual([]);

    const statBlock = createTemplateBlock('stat_badge', 0);
    expect(statBlock.designTokenStyle).toBe('stat.primary');
    expect('mappingKey' in statBlock).toBe(false);

    const headerBlock = createTemplateBlock('header', 0);
    expect(headerBlock.mappingKey).toBe('name');
  });

  it('adds, replaces, and removes packs, decks, and templates', () => {
    const project = makeProject();

    const pack = {
      id: 'pack-1',
      name: 'Starter',
      description: '',
      cardIds: ['card-1'],
    };
    const withPack = upsertProjectPack(project, pack);
    const renamedPack = { ...pack, name: 'Starter Set' };
    expect(
      upsertProjectPack(withPack, renamedPack).packs[0].name,
    ).toBe('Starter Set');
    expect(removeProjectPack(withPack, 'pack-1').packs).toEqual([]);

    const deck = {
      id: 'deck-1',
      profileId: project.profile.id,
      name: 'Main',
      format: 'Standard',
      entries: [{ cardId: 'card-1', count: 2 }],
      tags: ['aggro'],
    };
    const withDeck = upsertProjectDeck(project, deck);
    expect(
      upsertProjectDeck(withDeck, { ...deck, name: 'Aggro' }).decks[0].name,
    ).toBe('Aggro');
    expect(removeProjectDeck(withDeck, 'deck-1').decks).toEqual([]);

    const template = {
      ...createCardTemplateDraft(project.profile.id, 'Stats'),
      blocks: [{ ...createTemplateBlock('stat_badge', 0), mappingKey: 'attack' }],
    };
    const withTemplate = upsertProjectTemplate(project, template);
    expect(
      upsertProjectTemplate(withTemplate, {
        ...template,
        name: 'Stats v2',
      }).templates.find((item) => item.id === template.id)?.name,
    ).toBe('Stats v2');
    expect(
      removeProjectTemplate(withTemplate, template.id).templates.map(
        (item) => item.id,
      ),
    ).not.toContain(template.id);
  });

  it('unmaps template blocks when a profile field disappears', () => {
    const project = makeProject();
    const template = {
      ...createCardTemplateDraft(project.profile.id, 'Stats'),
      blocks: [
        { ...createTemplateBlock('stat_badge', 0), mappingKey: 'attack' },
      ],
    };
    const withTemplate = upsertProjectTemplate(project, template);
    expect(validateStoredProject(withTemplate).ok).toBe(true);

    const nextProfile = {
      ...structuredClone(withTemplate.profile),
      fieldDefinitions: [],
    };
    const updated = applyProfileToProject(withTemplate, nextProfile);
    const updatedTemplate = updated.templates.find(
      (item) => item.id === template.id,
    );

    expect(updatedTemplate?.blocks[0].mappingKey).toBeUndefined();
    expect(validateStoredProject(updated).ok).toBe(true);
  });

  it('merges incoming entities by ID and keeps existing entities', () => {
    const profile = makeProfile();
    const existing = upsertProjectCard(
      createProjectManifest(profile),
      makeCard(profile, 'card-1'),
    );
    const incoming = upsertProjectCard(
      createProjectManifest(profile),
      makeCard(profile, 'card-2'),
    );

    const merged = mergeProjectManifests(existing, incoming);

    expect(merged.projectId).toBe(existing.projectId);
    expect(merged.cards.map((card) => card.id)).toEqual([
      'card-1',
      'card-2',
    ]);
    expect(validateStoredProject(merged).ok).toBe(true);

    const incomingSameId = upsertProjectCard(
      createProjectManifest(profile),
      { ...makeCard(profile, 'card-1'), name: 'Incoming Dragon' },
    );
    const mergedSameId = mergeProjectManifests(existing, incomingSameId);

    expect(
      mergedSameId.cards.find((card) => card.id === 'card-1')?.name,
    ).toBe('Incoming Dragon');
  });

  it('returns the default template shape expected by card references', () => {
    const template = createDefaultCardTemplate('profile-1');

    expect(template.id).toBe(DEFAULT_CARD_TEMPLATE_ID);
    expect(template.blocks[0].mappingKey).toBe('name');
    expect(template.blocks[1].mappingKey).toBe('artAssetId');
    expect(template.blocks[2].mappingKey).toBe('rulesText');
    expect(template.blocks[3].mappingKey).toBe('subtypes');
  });
});
