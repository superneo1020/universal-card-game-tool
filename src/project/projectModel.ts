import { DEFAULT_CARD_TEMPLATE_ID, isCardRecordShape } from '../cards/cardModel';
import type {
  BlockType,
  CardTemplate,
  DesignTokenId,
  TemplateBlock,
} from '../types/Card';
import type { CardRecord } from '../types/CardRecord';
import type { CardPack, Deck } from '../types/Collection';
import type { GameProfile } from '../types/Game';
import type { AssetReference, ProjectManifest } from '../types/ProjectManifest';
import { CURRENT_SCHEMA_VERSION } from '../types/ProjectManifest';
import { createUniqueId } from '../utils/ids';
import type { ValidationIssue, ValidationResult } from '../utils/validation';
import {
  isContentHashId,
  isRecord,
  isTemplateBlockMappingCompatible,
  validateAssetReferenceRecord,
  validateCardPackRecord,
  validateCardTemplateRecord,
  validateDeckRecord,
  validateGameProfile,
} from '../utils/validation';

const DEFAULT_PROJECT_NAME = 'Untitled Project';

function fail(
  issues: readonly ValidationIssue[],
): ValidationResult<ProjectManifest> {
  return { ok: false, issues };
}

function pathChild(parent: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${parent}[${key}]`;
  }

  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function readArray(
  record: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
): unknown[] | null {
  const value = record[key];

  if (!Array.isArray(value)) {
    issues.push({
      path: `$.${key}`,
      code: 'expected_array',
      message: `Expected "${key}" to be an array.`,
    });
    return null;
  }

  return value;
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
): string | null {
  const value = record[key];
  const path = pathChild(parentPath, key);

  if (typeof value !== 'string') {
    issues.push({
      path,
      code: 'expected_string',
      message: `Expected "${key}" to be a string.`,
    });
    return null;
  }

  if (value.trim().length === 0) {
    issues.push({
      path,
      code: 'empty_string',
      message: `Expected "${key}" to be a non-empty string.`,
    });
    return null;
  }

  return value;
}

/**
 * The interim standard template. It only binds blocks to core card properties,
 * so profile field changes never invalidate it.
 */
export function createDefaultCardTemplate(profileId: string): CardTemplate {
  return {
    id: DEFAULT_CARD_TEMPLATE_ID,
    profileId,
    name: 'Standard card',
    layout: 'single',
    blocks: [
      {
        id: 'block-header',
        type: 'header',
        designTokenStyle: 'header.primary',
        mappingKey: 'name',
        order: 0,
      },
      {
        id: 'block-art',
        type: 'art_box',
        designTokenStyle: 'art.default',
        mappingKey: 'artAssetId',
        order: 1,
      },
      {
        id: 'block-textbox',
        type: 'textbox',
        designTokenStyle: 'textbox.rules',
        mappingKey: 'rulesText',
        order: 2,
      },
      {
        id: 'block-tags',
        type: 'tag_list',
        designTokenStyle: 'tag.neutral',
        mappingKey: 'subtypes',
        order: 3,
      },
    ],
  };
}

const DEFAULT_BLOCK_CONFIG: Readonly<
  Record<BlockType, { designTokenStyle: DesignTokenId; mappingKey?: string }>
> = {
  header: { designTokenStyle: 'header.primary', mappingKey: 'name' },
  art_box: { designTokenStyle: 'art.default', mappingKey: 'artAssetId' },
  textbox: { designTokenStyle: 'textbox.rules', mappingKey: 'rulesText' },
  stat_badge: { designTokenStyle: 'stat.primary' },
  splitter: { designTokenStyle: 'splitter.default' },
  tag_list: { designTokenStyle: 'tag.neutral', mappingKey: 'subtypes' },
  structured_list: { designTokenStyle: 'structured.default' },
};

/** Creates a new, unmapped block with a stable id and sensible token defaults. */
export function createTemplateBlock(
  type: BlockType,
  order: number,
): TemplateBlock {
  const config = DEFAULT_BLOCK_CONFIG[type];

  return {
    id: createUniqueId('block'),
    type,
    designTokenStyle: config.designTokenStyle,
    ...(config.mappingKey === undefined
      ? {}
      : { mappingKey: config.mappingKey }),
    order,
  };
}

/** Creates an empty custom template ready for block composition. */
export function createCardTemplateDraft(
  profileId: string,
  name = 'New template',
): CardTemplate {
  return {
    id: createUniqueId('template'),
    profileId,
    name,
    layout: 'single',
    blocks: [],
  };
}

/** Creates an empty manually curated pack. */
export function createPackDraft(): CardPack {
  return {
    id: createUniqueId('pack'),
    name: '',
    description: '',
    cardIds: [],
  };
}

/** Creates an empty deck owned by the active profile. */
export function createDeckDraft(profileId: string): Deck {
  return {
    id: createUniqueId('deck'),
    profileId,
    name: '',
    format: '',
    entries: [],
    tags: [],
  };
}

/** Creates a new project master copy around a saved profile. */
export function createProjectManifest(
  profile: GameProfile,
  projectName = DEFAULT_PROJECT_NAME,
): ProjectManifest {
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: createUniqueId('project'),
    projectName,
    createdAt: now,
    updatedAt: now,
    profile,
    templates: [createDefaultCardTemplate(profile.id)],
    cards: [],
    packs: [],
    decks: [],
    assets: [],
  };
}

/**
 * Updates the project profile and keeps template ownership aligned. Blocks
 * whose mapping is no longer supported by the new profile are left unmapped so
 * a profile edit does not become impossible to save.
 */
export function applyProfileToProject(
  project: ProjectManifest,
  profile: GameProfile,
): ProjectManifest {
  return {
    ...project,
    profile,
    templates: project.templates.map((template) => {
      const ownedTemplate =
        template.profileId === project.profile.id
          ? template.id === DEFAULT_CARD_TEMPLATE_ID
            ? createDefaultCardTemplate(profile.id)
            : { ...template, profileId: profile.id }
          : template;

      return {
        ...ownedTemplate,
        blocks: ownedTemplate.blocks.map((block) =>
          block.mappingKey === undefined ||
          isTemplateBlockMappingCompatible(
            block.type,
            block.mappingKey,
            profile,
          )
            ? block
            : { ...block, mappingKey: undefined },
        ),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/** Adds or replaces a card in the project. */
export function upsertProjectCard(
  project: ProjectManifest,
  card: CardRecord,
): ProjectManifest {
  const exists = project.cards.some((item) => item.id === card.id);

  return {
    ...project,
    cards: exists
      ? project.cards.map((item) => (item.id === card.id ? card : item))
      : [...project.cards, card],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes a card and every reference to it from packs and decks, keeping the
 * project referentially valid.
 */
export function removeProjectCard(
  project: ProjectManifest,
  cardId: string,
): ProjectManifest {
  return {
    ...project,
    cards: project.cards.filter((card) => card.id !== cardId),
    packs: project.packs.map((pack) =>
      pack.cardIds.includes(cardId)
        ? { ...pack, cardIds: pack.cardIds.filter((id) => id !== cardId) }
        : pack,
    ),
    decks: project.decks.map((deck) =>
      deck.entries.some((entry) => entry.cardId === cardId)
        ? {
            ...deck,
            entries: deck.entries.filter(
              (entry) => entry.cardId !== cardId,
            ),
          }
        : deck,
    ),
    updatedAt: new Date().toISOString(),
  };
}

/** Removes every card and clears pack/deck references to them. */
export function clearProjectCards(project: ProjectManifest): ProjectManifest {
  return {
    ...project,
    cards: [],
    packs: project.packs.map((pack) => ({ ...pack, cardIds: [] })),
    decks: project.decks.map((deck) => ({ ...deck, entries: [] })),
    updatedAt: new Date().toISOString(),
  };
}

/** Adds or replaces a pack. */
export function upsertProjectPack(
  project: ProjectManifest,
  pack: CardPack,
): ProjectManifest {
  const exists = project.packs.some((item) => item.id === pack.id);

  return {
    ...project,
    packs: exists
      ? project.packs.map((item) => (item.id === pack.id ? pack : item))
      : [...project.packs, pack],
    updatedAt: new Date().toISOString(),
  };
}

/** Removes a pack. */
export function removeProjectPack(
  project: ProjectManifest,
  packId: string,
): ProjectManifest {
  return {
    ...project,
    packs: project.packs.filter((pack) => pack.id !== packId),
    updatedAt: new Date().toISOString(),
  };
}

/** Adds or replaces a deck. */
export function upsertProjectDeck(
  project: ProjectManifest,
  deck: Deck,
): ProjectManifest {
  const exists = project.decks.some((item) => item.id === deck.id);

  return {
    ...project,
    decks: exists
      ? project.decks.map((item) => (item.id === deck.id ? deck : item))
      : [...project.decks, deck],
    updatedAt: new Date().toISOString(),
  };
}

/** Removes a deck. */
export function removeProjectDeck(
  project: ProjectManifest,
  deckId: string,
): ProjectManifest {
  return {
    ...project,
    decks: project.decks.filter((deck) => deck.id !== deckId),
    updatedAt: new Date().toISOString(),
  };
}

/** Adds or replaces content-addressed asset references. */
export function upsertProjectAssets(
  project: ProjectManifest,
  assets: readonly AssetReference[],
): ProjectManifest {
  if (assets.length === 0) {
    return project;
  }

  const byId = new Map(
    project.assets.map((asset) => [asset.assetId, asset]),
  );

  assets.forEach((asset) => {
    byId.set(asset.assetId, asset);
  });

  return {
    ...project,
    assets: [...byId.values()],
    updatedAt: new Date().toISOString(),
  };
}

interface IdentifiedEntity {
  readonly id: string;
}

function mergeById<T extends IdentifiedEntity>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map(existing.map((entity) => [entity.id, entity]));

  incoming.forEach((entity) => {
    byId.set(entity.id, entity);
  });

  return [...byId.values()];
}

/**
 * Merges an incoming manifest into the current project. Incoming entities win
 * for matching IDs; other entities are appended. Callers must ensure both
 * manifests share the same profile ID.
 */
export function mergeProjectManifests(
  existing: ProjectManifest,
  incoming: ProjectManifest,
): ProjectManifest {
  return {
    ...existing,
    profile: incoming.profile,
    templates: mergeById(existing.templates, incoming.templates),
    cards: mergeById(existing.cards, incoming.cards),
    packs: mergeById(existing.packs, incoming.packs),
    decks: mergeById(existing.decks, incoming.decks),
    assets: upsertProjectAssets(existing, incoming.assets).assets,
    updatedAt: new Date().toISOString(),
  };
}

/** Adds or replaces a card template. */
export function upsertProjectTemplate(
  project: ProjectManifest,
  template: CardTemplate,
): ProjectManifest {
  const exists = project.templates.some((item) => item.id === template.id);

  return {
    ...project,
    templates: exists
      ? project.templates.map((item) =>
          item.id === template.id ? template : item,
        )
      : [...project.templates, template],
    updatedAt: new Date().toISOString(),
  };
}

/** Removes a template. Callers must guard against the last template and usage. */
export function removeProjectTemplate(
  project: ProjectManifest,
  templateId: string,
): ProjectManifest {
  return {
    ...project,
    templates: project.templates.filter(
      (template) => template.id !== templateId,
    ),
    updatedAt: new Date().toISOString(),
  };
}

function validateTemplates(
  values: readonly unknown[],
  profile: GameProfile,
  issues: ValidationIssue[],
): CardTemplate[] | null {
  const templates: CardTemplate[] = [];
  const seenIds = new Set<string>();
  let valid = true;

  values.forEach((value, index) => {
    const path = pathChild('$.templates', index);
    const result = validateCardTemplateRecord(value, { path, profile });

    if (!result.ok) {
      issues.push(...result.issues);
      valid = false;
      return;
    }

    const template = result.value;
    if (seenIds.has(template.id)) {
      issues.push({
        path: pathChild(path, 'id'),
        code: 'duplicate_id',
        message: `Duplicate template id "${template.id}".`,
      });
      valid = false;
      return;
    }

    seenIds.add(template.id);
    templates.push(template);
  });

  if (values.length === 0) {
    issues.push({
      path: '$.templates',
      code: 'invalid_literal',
      message: 'A project must contain at least one card template.',
    });
    return null;
  }

  return valid ? templates : null;
}

function validateAssets(
  values: readonly unknown[],
  issues: ValidationIssue[],
): AssetReference[] | null {
  const assets: AssetReference[] = [];
  const seenIds = new Set<string>();
  let valid = true;

  values.forEach((value, index) => {
    const path = pathChild('$.assets', index);
    const result = validateAssetReferenceRecord(value, { path });

    if (!result.ok) {
      issues.push(...result.issues);
      valid = false;
      return;
    }

    const asset = result.value;
    if (seenIds.has(asset.assetId)) {
      issues.push({
        path: pathChild(path, 'assetId'),
        code: 'duplicate_id',
        message: `Duplicate asset id "${asset.assetId}".`,
      });
      valid = false;
      return;
    }

    seenIds.add(asset.assetId);
    assets.push(asset);
  });

  return valid ? assets : null;
}

function validatePacks(
  values: readonly unknown[],
  knownCardIds: ReadonlySet<string> | null,
  issues: ValidationIssue[],
): CardPack[] | null {
  const packs: CardPack[] = [];
  const seenIds = new Set<string>();
  let valid = true;

  values.forEach((value, index) => {
    const path = pathChild('$.packs', index);
    const result = validateCardPackRecord(value, { path, knownCardIds });

    if (!result.ok) {
      issues.push(...result.issues);
      valid = false;
      return;
    }

    const pack = result.value;
    if (seenIds.has(pack.id)) {
      issues.push({
        path: pathChild(path, 'id'),
        code: 'duplicate_id',
        message: `Duplicate pack id "${pack.id}".`,
      });
      valid = false;
      return;
    }

    seenIds.add(pack.id);
    packs.push(pack);
  });

  return valid ? packs : null;
}

function validateDecks(
  values: readonly unknown[],
  profileId: string,
  knownCardIds: ReadonlySet<string> | null,
  issues: ValidationIssue[],
): Deck[] | null {
  const decks: Deck[] = [];
  const seenIds = new Set<string>();
  let valid = true;

  values.forEach((value, index) => {
    const path = pathChild('$.decks', index);
    const result = validateDeckRecord(value, {
      path,
      profileId,
      knownCardIds,
    });

    if (!result.ok) {
      issues.push(...result.issues);
      valid = false;
      return;
    }

    const deck = result.value;
    if (seenIds.has(deck.id)) {
      issues.push({
        path: pathChild(path, 'id'),
        code: 'duplicate_id',
        message: `Duplicate deck id "${deck.id}".`,
      });
      valid = false;
      return;
    }

    seenIds.add(deck.id);
    decks.push(deck);
  });

  return valid ? decks : null;
}

/**
 * Card artwork must use a content hash that appears in the manifest asset
 * references. Missing local image bytes are allowed; a missing manifest
 * reference is not.
 */
function validateCardArtwork(
  card: CardRecord,
  cardPath: string,
  assetIds: ReadonlySet<string> | null,
  issues: ValidationIssue[],
): boolean {
  let valid = true;

  card.faces.forEach((face, faceIndex) => {
    const facePath = pathChild(pathChild(cardPath, 'faces'), faceIndex);
    const assetFields = [
      { key: 'artAssetId', assetId: face.artAssetId },
      { key: 'fullCardAssetId', assetId: face.fullCardAssetId ?? null },
    ] as const;

    assetFields.forEach(({ key, assetId }) => {
      if (assetId === null) {
        return;
      }

      const path = pathChild(facePath, key);

      if (!isContentHashId(assetId)) {
        issues.push({
          path,
          code: 'invalid_content_hash',
          message:
            'Card image references must be a lowercase 64-character SHA-256 hex digest or null.',
        });
        valid = false;
        return;
      }

      if (assetIds !== null && !assetIds.has(assetId)) {
        issues.push({
          path,
          code: 'unresolved_reference',
          message:
            'Card image has no matching asset reference in this project.',
        });
        valid = false;
      }
    });
  });

  return valid;
}

/**
 * Lenient internal persistence validation for the project master copy.
 *
 * Profile schema, ownership, references, and unique IDs are enforced. Card
 * attribute compatibility is intentionally left to the card editor so orphaned
 * values remain recoverable. Import/export must still use the strict manifest
 * guard.
 */
export function validateStoredProject(
  data: unknown,
): ValidationResult<ProjectManifest> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(data)) {
    return fail([
      {
        path: '$',
        code: 'expected_object',
        message: 'Project must be an object.',
      },
    ]);
  }

  if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    issues.push({
      path: '$.schemaVersion',
      code: 'invalid_version',
      message: `Project must use schemaVersion ${CURRENT_SCHEMA_VERSION}.`,
    });
  }

  const projectId = requireNonEmptyString(data, 'projectId', '$', issues);
  const projectName = requireNonEmptyString(
    data,
    'projectName',
    '$',
    issues,
  );

  if (data.createdAt !== undefined && typeof data.createdAt !== 'string') {
    issues.push({
      path: '$.createdAt',
      code: 'expected_string',
      message: 'Project createdAt must be a string when present.',
    });
  }

  if (data.updatedAt !== undefined && typeof data.updatedAt !== 'string') {
    issues.push({
      path: '$.updatedAt',
      code: 'expected_string',
      message: 'Project updatedAt must be a string when present.',
    });
  }

  const profileResult = validateGameProfile(data.profile);
  if (!profileResult.ok) {
    issues.push(
      ...profileResult.issues.map((issue) => ({
        ...issue,
        path:
          issue.path === '$'
            ? '$.profile'
            : issue.path.replace(/^\$/, '$.profile'),
      })),
    );
    return fail(issues);
  }

  const profile = profileResult.value;

  const templateValues = readArray(data, 'templates', issues);
  const cardValues = readArray(data, 'cards', issues);
  const packValues = readArray(data, 'packs', issues);
  const deckValues = readArray(data, 'decks', issues);
  const assetValues = readArray(data, 'assets', issues);

  const assets =
    assetValues === null ? null : validateAssets(assetValues, issues);

  const assetIds =
    assets === null
      ? null
      : new Set(assets.map((asset) => asset.assetId));

  const templates =
    templateValues === null
      ? null
      : validateTemplates(templateValues, profile, issues);

  const templateIds =
    templates === null
      ? null
      : new Set(templates.map((template) => template.id));

  const cards: CardRecord[] = [];
  if (cardValues !== null) {
    const seenCardIds = new Set<string>();

    cardValues.forEach((value, index) => {
      const path = pathChild('$.cards', index);

      if (!isCardRecordShape(value)) {
        issues.push({
          path,
          code: 'invalid_literal',
          message: 'Stored card record is malformed.',
        });
        return;
      }

      if (value.profileId !== profile.id) {
        issues.push({
          path: pathChild(path, 'profileId'),
          code: 'unresolved_reference',
          message: 'Card belongs to a different game profile.',
        });
        return;
      }

      if (seenCardIds.has(value.id)) {
        issues.push({
          path: pathChild(path, 'id'),
          code: 'duplicate_id',
          message: `Duplicate card id "${value.id}".`,
        });
        return;
      }

      if (templateIds !== null && !templateIds.has(value.templateId)) {
        issues.push({
          path: pathChild(path, 'templateId'),
          code: 'unresolved_reference',
          message: 'Card references a template that is not in this project.',
        });
        return;
      }

      if (!validateCardArtwork(value, path, assetIds, issues)) {
        return;
      }

      seenCardIds.add(value.id);
      cards.push(value);
    });
  }

  const cardIds = new Set(cards.map((card) => card.id));

  const packs =
    packValues === null ? null : validatePacks(packValues, cardIds, issues);
  const decks =
    deckValues === null
      ? null
      : validateDecks(deckValues, profile.id, cardIds, issues);

  if (
    projectId === null ||
    projectName === null ||
    templates === null ||
    packs === null ||
    decks === null ||
    assets === null ||
    issues.length > 0
  ) {
    return fail(issues);
  }

  return {
    ok: true,
    value: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectId,
      projectName,
      createdAt:
        typeof data.createdAt === 'string' ? data.createdAt : undefined,
      updatedAt:
        typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
      profile,
      templates,
      cards,
      packs,
      decks,
      assets,
    },
  };
}
