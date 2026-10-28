import type { CardFace, CardRecord, FieldValue } from '../types/CardRecord';
import type {
  FieldDefinition,
  GameProfile,
  StructuredFieldEntry,
} from '../types/Game';
import { createUniqueId } from '../utils/ids';
import type { ValidationIssue } from '../utils/validation';
import { isRecord, validateFieldValue } from '../utils/validation';

/** Transitional default template id until templates are editable/persisted. */
export const DEFAULT_CARD_TEMPLATE_ID = 'template-standard';

export type AttributeTarget = FieldDefinition['target'];

function attributePath(
  target: AttributeTarget,
  key: string,
  faceIndex = 0,
): string {
  const base =
    target === 'root'
      ? '$.rootAttributes'
      : `$.faces[${faceIndex}].faceAttributes`;

  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

function cloneFieldValue(value: FieldValue): FieldValue {
  if (!Array.isArray(value)) {
    return value;
  }

  const structured = value.filter(isStructuredFieldEntry);

  if (structured.length === value.length) {
    return structured.map((entry) => ({
      entryId: entry.entryId,
      values: Object.fromEntries(
        Object.entries(entry.values).map(([key, child]) => [
          key,
          cloneFieldValue(child),
        ]),
      ),
    }));
  }

  return value.filter(
    (item): item is string | number =>
      typeof item === 'string' || typeof item === 'number',
  );
}

function cloneDefaultValue(field: FieldDefinition): FieldValue | undefined {
  const value = field.defaultValue;

  if (value === undefined) {
    return undefined;
  }

  return cloneFieldValue(value);
}

function isFieldApplicableToCardType(
  field: FieldDefinition,
  cardType: string,
): boolean {
  return (
    field.cardTypes === undefined ||
    field.cardTypes.length === 0 ||
    field.cardTypes.includes(cardType)
  );
}

function defaultsFor(
  profile: GameProfile,
  target: AttributeTarget,
  cardType: string,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};

  for (const field of profile.fieldDefinitions) {
    if (
      field.target !== target ||
      !isFieldApplicableToCardType(field, cardType)
    ) {
      continue;
    }

    const value = cloneDefaultValue(field);
    if (value !== undefined) {
      values[field.key] = value;
    }
  }

  return values;
}

/** Creates a new single-face card initialized with profile defaults. */
export function createCardDraft(profile: GameProfile): CardRecord {
  const cardType = profile.cardTypes[0] ?? '';

  return {
    id: createUniqueId('card'),
    profileId: profile.id,
    templateId: DEFAULT_CARD_TEMPLATE_ID,
    name: '',
    cardType,
    subtypes: [],
    faces: [
      {
        faceId: 'front',
        rulesText: '',
        artAssetId: null,
        fullCardAssetId: null,
        faceAttributes: defaultsFor(profile, 'face', cardType),
      },
    ],
    rootAttributes: defaultsFor(profile, 'root', cardType),
    tags: [],
  };
}

/** Returns the primary face, synthesizing a blank one for malformed records. */
export function getCardFace(card: CardRecord): CardFace {
  return (
    card.faces[0] ?? {
      faceId: 'front',
      rulesText: '',
      artAssetId: null,
      fullCardAssetId: null,
      faceAttributes: {},
    }
  );
}

/** Returns a specific face by id, if present. */
export function getCardFaceById(
  card: CardRecord,
  faceId: string,
): CardFace | undefined {
  return card.faces.find((face) => face.faceId === faceId);
}

/** Creates a blank face initialized with profile face defaults. */
export function createCardFace(
  profile: GameProfile,
  faceId = createUniqueId('face'),
  cardType = profile.cardTypes[0] ?? '',
): CardFace {
  return {
    faceId,
    rulesText: '',
    artAssetId: null,
    fullCardAssetId: null,
    faceAttributes: defaultsFor(profile, 'face', cardType),
  };
}

/** Returns the attribute bag for a root- or face-targeted field. */
export function getAttributeRecord(
  card: CardRecord,
  target: AttributeTarget,
  faceId?: string,
): Record<string, FieldValue> {
  if (target === 'root') {
    return card.rootAttributes;
  }

  const face =
    faceId === undefined
      ? getCardFace(card)
      : (getCardFaceById(card, faceId) ?? getCardFace(card));

  return face.faceAttributes;
}

/** Reads one dynamic attribute, if present. */
export function getCardAttributeValue(
  card: CardRecord,
  target: AttributeTarget,
  key: string,
  faceId?: string,
): FieldValue | undefined {
  return getAttributeRecord(card, target, faceId)[key];
}

/** Adds, replaces, or removes a dynamic attribute without mutating the card. */
export function setCardAttributeValue(
  card: CardRecord,
  target: AttributeTarget,
  key: string,
  value: FieldValue | undefined,
  faceId?: string,
): CardRecord {
  if (target === 'root') {
    const attributes = { ...card.rootAttributes };

    if (value === undefined) {
      delete attributes[key];
    } else {
      attributes[key] = value;
    }

    return { ...card, rootAttributes: attributes };
  }

  const selectedFace =
    faceId === undefined
      ? getCardFace(card)
      : (getCardFaceById(card, faceId) ?? getCardFace(card));
  const attributes = { ...selectedFace.faceAttributes };

  if (value === undefined) {
    delete attributes[key];
  } else {
    attributes[key] = value;
  }

  const updatedFace: CardFace = { ...selectedFace, faceAttributes: attributes };
  const faces =
    card.faces.length === 0
      ? [updatedFace]
      : card.faces.map((face) =>
          face.faceId === selectedFace.faceId ? updatedFace : face,
        );

  return { ...card, faces };
}

/** Updates one face without mutating the card. */
export function updateCardFaceById(
  card: CardRecord,
  faceId: string,
  patch: Partial<
    Pick<
      CardFace,
      'name' | 'cardType' | 'subtypes' | 'rulesText' | 'flavorText' | 'artAssetId' | 'fullCardAssetId'
    >
  >,
): CardRecord {
  const faces = card.faces.map((face) =>
    face.faceId === faceId ? { ...face, ...patch } : face,
  );

  return { ...card, faces };
}

/**
 * Adds profile defaults for applicable fields that have no value yet.
 *
 * Existing values, including values that are no longer applicable after a type
 * change, are never removed here. They become orphaned values so the editor can
 * preserve or explicitly clear them.
 */
function seedMissingFieldDefaults(
  attributes: Record<string, FieldValue>,
  profile: GameProfile,
  target: AttributeTarget,
  cardType: string,
): Record<string, FieldValue> {
  let next: Record<string, FieldValue> | null = null;

  for (const field of profile.fieldDefinitions) {
    if (
      field.target !== target ||
      !isFieldApplicableToCardType(field, cardType) ||
      attributes[field.key] !== undefined
    ) {
      continue;
    }

    const value = cloneDefaultValue(field);
    if (value === undefined) {
      continue;
    }

    next ??= { ...attributes };
    next[field.key] = value;
  }

  return next ?? attributes;
}

/**
 * Applies a new card-level type and seeds missing defaults for root fields and
 * faces that inherit that type. Faces with explicit type overrides are left
 * unchanged.
 */
export function seedDefaultsForCardType(
  card: CardRecord,
  profile: GameProfile,
  cardType: string,
): CardRecord {
  return {
    ...card,
    cardType,
    rootAttributes: seedMissingFieldDefaults(
      card.rootAttributes,
      profile,
      'root',
      cardType,
    ),
    faces: card.faces.map((face) =>
      face.cardType === undefined
        ? {
            ...face,
            faceAttributes: seedMissingFieldDefaults(
              face.faceAttributes,
              profile,
              'face',
              cardType,
            ),
          }
        : face,
    ),
  };
}

/**
 * Applies or clears a face type override and seeds missing defaults using the
 * resulting effective type. Existing face values are preserved.
 */
export function seedDefaultsForFaceType(
  card: CardRecord,
  profile: GameProfile,
  faceId: string,
  cardType: string | undefined,
): CardRecord {
  const faces = card.faces.map((face) => {
    if (face.faceId !== faceId) {
      return face;
    }

    const nextFace: CardFace = {
      ...face,
      faceAttributes: seedMissingFieldDefaults(
        face.faceAttributes,
        profile,
        'face',
        cardType ?? card.cardType,
      ),
    };

    if (cardType === undefined) {
      delete nextFace.cardType;
    } else {
      nextFace.cardType = cardType;
    }

    return nextFace;
  });

  return { ...card, faces };
}

/** Updates the primary face's core text fields. */
export function updateCardFace(
  card: CardRecord,
  patch: Partial<
    Pick<
      CardFace,
      'name' | 'cardType' | 'subtypes' | 'rulesText' | 'flavorText' | 'artAssetId' | 'fullCardAssetId'
    >
  >,
): CardRecord {
  const face = { ...getCardFace(card), ...patch };
  const faces = card.faces.length === 0 ? [face] : [face, ...card.faces.slice(1)];

  return { ...card, faces };
}

export interface CardFieldState {
  readonly definition: FieldDefinition;
  readonly value: FieldValue | undefined;
  readonly issues: readonly ValidationIssue[];
}

export interface OrphanedCardAttribute {
  readonly key: string;
  readonly target: AttributeTarget;
  readonly value: FieldValue;
  /** Present for face-targeted values. */
  readonly faceId?: string;
}

export interface CardFaceReconciliation {
  readonly faceId: string;
  readonly fields: readonly CardFieldState[];
  readonly orphaned: readonly OrphanedCardAttribute[];
  readonly issues: readonly ValidationIssue[];
}

export interface CardReconciliation {
  /** Root fields plus the first face's fields, for existing callers. */
  readonly fields: readonly CardFieldState[];
  readonly orphaned: readonly OrphanedCardAttribute[];
  readonly issues: readonly ValidationIssue[];
  /** Per-face field validation, in card face order. */
  readonly faces: readonly CardFaceReconciliation[];
}

interface AttributeReconciliation {
  readonly fields: CardFieldState[];
  readonly orphaned: OrphanedCardAttribute[];
  readonly issues: ValidationIssue[];
}

function reconcileAttributes(
  target: AttributeTarget,
  attributes: Record<string, FieldValue>,
  profile: GameProfile,
  cardType: string,
  pathFor: (key: string) => string,
): AttributeReconciliation {
  const definitions = profile.fieldDefinitions.filter(
    (definition) =>
      definition.target === target &&
      isFieldApplicableToCardType(definition, cardType),
  );
  const definitionKeys = new Set(definitions.map((definition) => definition.key));
  const fields: CardFieldState[] = [];
  const orphaned: OrphanedCardAttribute[] = [];
  const issues: ValidationIssue[] = [];

  for (const definition of definitions) {
    const path = pathFor(definition.key);
    const value = attributes[definition.key];
    const fieldIssues: ValidationIssue[] = [];

    if (value === undefined) {
      if (definition.required === true) {
        const issue: ValidationIssue = {
          path,
          code: 'missing_required_field',
          message: `Required ${target} field "${definition.label}" is missing.`,
        };
        fieldIssues.push(issue);
        issues.push(issue);
      }
    } else {
      const validationIssues = validateFieldValue(definition, value, path);
      fieldIssues.push(...validationIssues);
      issues.push(...validationIssues);
    }

    fields.push({ definition, value, issues: fieldIssues });
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (!definitionKeys.has(key)) {
      orphaned.push({ key, target, value });
    }
  }

  return { fields, orphaned, issues };
}

/**
 * Reconciles card data against the current profile.
 *
 * Active fields are validated against their definitions for the root and every
 * face. Values whose field definition was removed are reported as orphaned but
 * are never dropped; the editor can remove them explicitly. Incompatible values
 * remain visible and block saving until corrected or cleared.
 */
export function reconcileCard(
  card: CardRecord,
  profile: GameProfile,
): CardReconciliation {
  const coreIssues: ValidationIssue[] = [];

  if (card.name.trim().length === 0) {
    coreIssues.push({
      path: '$.name',
      code: 'empty_string',
      message: 'Card name is required.',
    });
  }

  if (card.profileId !== profile.id) {
    coreIssues.push({
      path: '$.profileId',
      code: 'unresolved_reference',
      message: 'This card belongs to a different game profile.',
    });
  }

  if (!profile.cardTypes.includes(card.cardType)) {
    coreIssues.push({
      path: '$.cardType',
      code: 'invalid_reference',
      message: `Card type "${card.cardType}" is not declared by the current profile.`,
    });
  }

  card.subtypes.forEach((subtype, index) => {
    if (!profile.subtypes.includes(subtype)) {
      coreIssues.push({
        path: `$.subtypes[${index}]`,
        code: 'invalid_reference',
        message: `Subtype "${subtype}" is no longer declared by the current profile.`,
      });
    }
  });

  if (card.faces.length === 0) {
    coreIssues.push({
      path: '$.faces',
      code: 'invalid_literal',
      message: 'A card must have at least one face.',
    });
  }

  const root = reconcileAttributes(
    'root',
    card.rootAttributes,
    profile,
    card.cardType,
    (key) => attributePath('root', key),
  );
  const faces: CardFaceReconciliation[] = [];
  const fields: CardFieldState[] = [...root.fields];
  const orphaned: OrphanedCardAttribute[] = [...root.orphaned];
  const issues: ValidationIssue[] = [...coreIssues, ...root.issues];

  card.faces.forEach((face, index) => {
    const faceCardType = face.cardType ?? card.cardType;

    if (face.cardType !== undefined && !profile.cardTypes.includes(face.cardType)) {
      issues.push({
        path: `$.faces[${index}].cardType`,
        code: 'invalid_reference',
        message: `Face type "${face.cardType}" is not declared by the current profile.`,
      });
    }

    if (face.subtypes !== undefined) {
      face.subtypes.forEach((subtype, subtypeIndex) => {
        if (!profile.subtypes.includes(subtype)) {
          issues.push({
            path: `$.faces[${index}].subtypes[${subtypeIndex}]`,
            code: 'invalid_reference',
            message: `Face subtype "${subtype}" is no longer declared by the current profile.`,
          });
        }
      });
    }

    const faceResult = reconcileAttributes(
      'face',
      face.faceAttributes,
      profile,
      faceCardType,
      (key) => attributePath('face', key, index),
    );
    const faceOrphaned = faceResult.orphaned.map((attribute) => ({
      ...attribute,
      faceId: face.faceId,
    }));

    faces.push({
      faceId: face.faceId,
      fields: faceResult.fields,
      orphaned: faceOrphaned,
      issues: faceResult.issues,
    });
    issues.push(...faceResult.issues);
    orphaned.push(...faceOrphaned);

    if (index === 0) {
      fields.push(...faceResult.fields);
    }
  });

  return { fields, orphaned, issues, faces };
}

/** True when a card has no blocking profile/core issues. */
export function isCardSavable(card: CardRecord, profile: GameProfile): boolean {
  return reconcileCard(card, profile).issues.length === 0;
}

function searchableAttributeValues(value: FieldValue): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return [String(item)];
      }

      if (isStructuredFieldEntry(item)) {
        return Object.values(item.values).flatMap(searchableAttributeValues);
      }

      return [];
    });
  }

  if (typeof value === 'boolean') {
    return [value ? 'true' : 'false'];
  }

  return [String(value)];
}

/**
 * Search matches card name, type, subtypes, tags, face text, and every
 * profile-driven attribute value (including list entries).
 */
export function filterCards(
  cards: readonly CardRecord[],
  query: string,
  tag: string | null,
): CardRecord[] {
  const normalizedQuery = query.trim().toLowerCase();

  return cards.filter((card) => {
    if (tag !== null && !card.tags.includes(tag)) {
      return false;
    }

    if (normalizedQuery.length === 0) {
      return true;
    }

    const faceValues = card.faces.flatMap((face) => [
      face.name ?? '',
      face.cardType ?? '',
      ...(face.subtypes ?? []),
      face.rulesText,
      face.flavorText ?? '',
      ...Object.values(face.faceAttributes).flatMap(
        searchableAttributeValues,
      ),
    ]);
    const rootValues = Object.values(card.rootAttributes).flatMap(
      searchableAttributeValues,
    );

    return [
      card.name,
      card.cardType,
      ...card.subtypes,
      ...card.tags,
      ...faceValues,
      ...rootValues,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

/** Collects sorted, unique tags across the library. */
export function collectCardTags(cards: readonly CardRecord[]): string[] {
  const tags = new Set<string>();

  for (const card of cards) {
    for (const tag of card.tags) {
      tags.add(tag);
    }
  }

  return [...tags].sort((left, right) => left.localeCompare(right));
}

/** Formats a runtime attribute for previews and summaries. */
export function formatFieldValue(value: FieldValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '—';
    }

    if (value.every((item) => typeof item !== 'object')) {
      return value.join(', ');
    }

    return value
      .map((item) =>
        isStructuredFieldEntry(item)
          ? Object.values(item.values)
              .map((child) => formatFieldValue(child))
              .join(' · ')
          : '',
      )
      .filter((text) => text.length > 0)
      .join('; ');
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
}

/**
 * True when a value has visible content for rendering and hide-when-empty.
 * `0` and `false` count as present; empty, whitespace-only, and empty-list
 * values do not.
 */
export function isPresentFieldValue(value: FieldValue | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => {
      if (typeof item === 'string') {
        return item.trim().length > 0;
      }

      if (typeof item === 'number') {
        return true;
      }

      return (
        isStructuredFieldEntry(item) &&
        Object.values(item.values).some(isPresentFieldValue)
      );
    });
  }

  return true;
}

/** Runtime type guard for the JSON value domain stored in attribute bags. */
export function isFieldValue(value: unknown): value is FieldValue {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isScalarFieldValueItem) || value.every(isStructuredFieldEntry);
  }

  return false;
}

function isScalarFieldValueItem(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isStructuredFieldEntry(value: unknown): value is StructuredFieldEntry {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.entryId !== 'string' || value.entryId.trim().length === 0) {
    return false;
  }

  if (!isRecord(value.values)) {
    return false;
  }

  return Object.values(value.values).every(isFieldValue);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function isAttributeRecord(
  value: unknown,
): value is Record<string, FieldValue> {
  return isRecord(value) && Object.values(value).every(isFieldValue);
}

function isCardFaceShape(value: unknown): value is CardFace {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.faceId !== 'string' || value.faceId.trim().length === 0) {
    return false;
  }

  if (value.name !== undefined && typeof value.name !== 'string') {
    return false;
  }

  if (value.cardType !== undefined) {
    if (typeof value.cardType !== 'string' || value.cardType.trim().length === 0) {
      return false;
    }
  }

  if (value.subtypes !== undefined && !isStringArray(value.subtypes)) {
    return false;
  }

  if (typeof value.rulesText !== 'string') {
    return false;
  }

  if (value.flavorText !== undefined && typeof value.flavorText !== 'string') {
    return false;
  }

  if (value.artAssetId !== null && typeof value.artAssetId !== 'string') {
    return false;
  }

  if (
    value.fullCardAssetId !== undefined &&
    value.fullCardAssetId !== null &&
    typeof value.fullCardAssetId !== 'string'
  ) {
    return false;
  }

  return isAttributeRecord(value.faceAttributes);
}

/** Structural guard for persisted card records (profile semantics excluded). */
export function isCardRecordShape(value: unknown): value is CardRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    typeof value.profileId !== 'string' ||
    value.profileId.trim().length === 0 ||
    typeof value.templateId !== 'string' ||
    value.templateId.trim().length === 0 ||
    typeof value.name !== 'string' ||
    typeof value.cardType !== 'string'
  ) {
    return false;
  }

  if (!isStringArray(value.subtypes) || !isStringArray(value.tags)) {
    return false;
  }

  if (!Array.isArray(value.faces) || value.faces.length === 0) {
    return false;
  }

  if (!value.faces.every(isCardFaceShape)) {
    return false;
  }

  return isAttributeRecord(value.rootAttributes);
}
