/**
 * Runtime schema validation for versioned project manifests.
 *
 * All public entry points accept `unknown`. Untrusted data (JSON imports,
 * IndexedDB hydration, URL snapshots) must be validated here before it is
 * used to update application state. Nothing in this module mutates its input:
 * invalid payloads are reported as structured `ValidationIssue` values, and
 * migrations return fresh objects.
 *
 * The checks are intentionally stricter than the compile-time interfaces in
 * `src/types`: TypeScript cannot validate runtime-configured field schemas or
 * imported JSON, so every structural and referential invariant is enforced
 * explicitly at runtime.
 */

import type { BlockType, CardTemplate, DesignTokenId } from '../types/Card';
import type { CardFace, CardRecord } from '../types/CardRecord';
import type { CardPack, Deck } from '../types/Collection';
import type { FieldDefinition, FieldType, GameProfile } from '../types/Game';
import { MAX_STRUCTURED_DEPTH } from '../types/Game';
import type { AssetReference, ProjectManifest } from '../types/ProjectManifest';
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../types/ProjectManifest';

const ROOT_PATH = '$';

// ==========================================
// RESULT & ISSUE TYPES
// ==========================================

export type ValidationIssueCode =
  | 'parse_error'
  | 'expected_object'
  | 'expected_array'
  | 'expected_string'
  | 'expected_number'
  | 'expected_integer'
  | 'expected_boolean'
  | 'missing_property'
  | 'empty_string'
  | 'invalid_literal'
  | 'invalid_version'
  | 'unsupported_version'
  | 'migration_required'
  | 'missing_migration'
  | 'invalid_migration'
  | 'duplicate_id'
  | 'duplicate_value'
  | 'unresolved_reference'
  | 'invalid_reference'
  | 'invalid_content_hash'
  | 'content_hash_mismatch'
  | 'byte_size_mismatch'
  | 'expected_binary_data'
  | 'unknown_field'
  | 'missing_required_field'
  | 'invalid_field_value'
  | 'invalid_default_value'
  | 'out_of_range'
  | 'manifest_too_large';

/** A single, path-addressed validation failure. */
export interface ValidationIssue {
  /** JSON-path-like location, e.g. `$.cards[2].faces[0].artAssetId`. */
  readonly path: string;
  readonly code: ValidationIssueCode;
  readonly message: string;
}

/** Discriminated result used by validating entry points. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function fail<T>(issues: readonly ValidationIssue[]): ValidationResult<T> {
  return { ok: false, issues };
}

// ==========================================
// CONSTANT LOOKUPS
// ==========================================
//
// These `Record` annotations make coverage compile-time enforced: adding a
// variant to `FieldType`, `BlockType`, `CardTemplate['layout']`, or
// `FieldDefinition['target']` without updating the runtime lookup becomes a
// TypeScript error.

const FIELD_TYPE_KIND_LOOKUP: Readonly<Record<FieldType['type'], true>> = {
  text: true,
  number: true,
  boolean: true,
  enum: true,
  list: true,
  structured: true,
};

const FIELD_TARGET_LOOKUP: Readonly<Record<FieldDefinition['target'], true>> = {
  face: true,
  root: true,
};

const CARD_LAYOUT_LOOKUP: Readonly<Record<CardTemplate['layout'], true>> = {
  single: true,
  double_sided: true,
  split: true,
};

const BLOCK_TYPE_LOOKUP: Readonly<Record<BlockType, true>> = {
  header: true,
  art_box: true,
  textbox: true,
  stat_badge: true,
  splitter: true,
  tag_list: true,
  structured_list: true,
};

const DESIGN_TOKEN_LOOKUP: Readonly<Record<DesignTokenId, true>> = {
  'header.primary': true,
  'header.secondary': true,
  'art.default': true,
  'art.fullBleed': true,
  'textbox.body': true,
  'textbox.flavor': true,
  'textbox.rules': true,
  'stat.primary': true,
  'stat.secondary': true,
  'splitter.default': true,
  'splitter.strong': true,
  'tag.neutral': true,
  'tag.accent': true,
  'tag.muted': true,
  'structured.default': true,
  'structured.compact': true,
};

/** Whitelisted design-token IDs available to template editors and renderers. */
export const DESIGN_TOKEN_IDS: readonly DesignTokenId[] = Object.keys(
  DESIGN_TOKEN_LOOKUP,
) as readonly DesignTokenId[];

interface BlockMappingPolicy {
  readonly coreKeys: readonly string[];
  readonly fieldTypes: readonly FieldType['type'][];
  readonly fieldTargets: readonly FieldDefinition['target'][];
}

/**
 * Declares which core properties and profile field types each structural block
 * may display. This keeps block-to-field mappings compatible with the block's
 * rendering role: an art box cannot bind a numeric attack field, and a stat
 * badge cannot bind a name or enum field.
 */
const BLOCK_MAPPING_POLICY: Readonly<Record<BlockType, BlockMappingPolicy>> = {
  header: {
    coreKeys: ['name', 'cardType'],
    fieldTypes: [],
    fieldTargets: [],
  },
  art_box: {
    coreKeys: ['artAssetId'],
    fieldTypes: [],
    fieldTargets: [],
  },
  textbox: {
    coreKeys: ['rulesText', 'flavorText'],
    fieldTypes: [],
    fieldTargets: [],
  },
  stat_badge: {
    coreKeys: [],
    fieldTypes: ['number'],
    fieldTargets: ['root', 'face'],
  },
  splitter: {
    coreKeys: [],
    fieldTypes: [],
    fieldTargets: [],
  },
  tag_list: {
    coreKeys: ['subtypes', 'tags'],
    fieldTypes: [],
    fieldTargets: [],
  },
  structured_list: {
    coreKeys: [],
    fieldTypes: ['structured'],
    fieldTargets: ['root', 'face'],
  },
};

function describeBlockMappingPolicy(blockType: BlockType): string {
  const policy = BLOCK_MAPPING_POLICY[blockType];
  const parts = [...policy.coreKeys];

  if (policy.fieldTypes.length > 0) {
    parts.push(
      `${policy.fieldTypes.join(' or ')} field (${policy.fieldTargets.join(
        ' or ',
      )} target)`,
    );
  }

  return parts.length === 0 ? 'no mapping key' : parts.join(', ');
}

const CORE_MAPPING_LABELS: Readonly<Record<string, string>> = {
  name: 'Card name',
  cardType: 'Card type',
  artAssetId: 'Artwork',
  rulesText: 'Rules text',
  flavorText: 'Flavor text',
  subtypes: 'Subtypes',
  tags: 'Tags',
};

export interface TemplateBlockMappingOption {
  readonly key: string;
  readonly label: string;
}

/**
 * Lists the core properties and profile fields a block type may display.
 * The editor uses this so it can only offer mappings the validator accepts.
 */
export function getTemplateBlockMappingOptions(
  blockType: BlockType,
  profile: GameProfile,
): readonly TemplateBlockMappingOption[] {
  const policy = BLOCK_MAPPING_POLICY[blockType];
  const options: TemplateBlockMappingOption[] = policy.coreKeys.map((key) => ({
    key,
    label: CORE_MAPPING_LABELS[key] ?? key,
  }));

  if (policy.fieldTypes.length > 0) {
    profile.fieldDefinitions
      .filter(
        (definition) =>
          policy.fieldTypes.includes(definition.type.type) &&
          policy.fieldTargets.includes(definition.target),
      )
      .forEach((definition) => {
        const applicableTypes =
          definition.cardTypes === undefined ||
          definition.cardTypes.length === 0
            ? ''
            : ` · ${definition.cardTypes.join(' / ')}`;
        options.push({
          key: definition.key,
          label: `${definition.label} (${definition.target}${applicableTypes})`,
        });
      });
  }

  return options;
}

/** Returns whether a mapping key is valid for a block and active profile. */
export function isTemplateBlockMappingCompatible(
  blockType: BlockType,
  mappingKey: string,
  profile: GameProfile,
): boolean {
  const policy = BLOCK_MAPPING_POLICY[blockType];

  if (policy.coreKeys.includes(mappingKey)) {
    return true;
  }

  const definition = profile.fieldDefinitions.find(
    (field) => field.key === mappingKey,
  );

  return (
    definition !== undefined &&
    policy.fieldTypes.includes(definition.type.type) &&
    policy.fieldTargets.includes(definition.target)
  );
}

// ==========================================
// LOW-LEVEL HELPERS
// ==========================================

/**
 * Narrows an untrusted value to a JSON-object-like record.
 *
 * Arrays and `null` are rejected; this is the gate used before any property
 * access on imported data.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${parent}[${key}]`;
  }
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function pushIssue(
  issues: ValidationIssue[],
  path: string,
  code: ValidationIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return JSON.stringify(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return typeof value;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union variant: ${describeValue(value)}`);
}

function isFieldTypeKind(value: string): value is FieldType['type'] {
  return Object.hasOwn(FIELD_TYPE_KIND_LOOKUP, value);
}

function isFieldTarget(value: string): value is FieldDefinition['target'] {
  return Object.hasOwn(FIELD_TARGET_LOOKUP, value);
}

function isCardLayout(value: string): value is CardTemplate['layout'] {
  return Object.hasOwn(CARD_LAYOUT_LOOKUP, value);
}

function isBlockType(value: string): value is BlockType {
  return Object.hasOwn(BLOCK_TYPE_LOOKUP, value);
}

function isDesignTokenId(value: string): value is DesignTokenId {
  return Object.hasOwn(DESIGN_TOKEN_LOOKUP, value);
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Content-addressed asset identity is the lowercase hexadecimal SHA-256 digest
 * of the image bytes. Filenames and paths are hints only and never validated
 * as identity.
 */
export function isContentHashId(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function monthLength(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= monthLength(year, month);
}

/**
 * Strict ISO-8601 check for the two shapes the manifest accepts: calendar
 * dates (`YYYY-MM-DD`) and UTC/offset date-times (`YYYY-MM-DDTHH:mm:ss[.SSS]Z`
 * or `...+HH:mm`). Unlike `Date.parse`, this rejects rolled-over dates such as
 * `2026-02-30`.
 */
function isValidIso8601Date(value: string): boolean {
  const dateOnly = ISO_DATE_ONLY_PATTERN.exec(value);
  if (dateOnly !== null) {
    return isValidCalendarDate(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
    );
  }

  const dateTime = ISO_DATE_TIME_PATTERN.exec(value);
  if (dateTime === null) {
    return false;
  }

  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hours = Number(dateTime[4]);
  const minutes = Number(dateTime[5]);
  const seconds = Number(dateTime[6]);
  const offset = dateTime[8];

  if (
    !isValidCalendarDate(year, month, day) ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return false;
  }

  if (offset !== 'Z') {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      return false;
    }
  }

  return !Number.isNaN(Date.parse(value));
}

// ==========================================
// TYPED PROPERTY READERS
// ==========================================
//
// These readers push issues and return `null` when a property is missing or
// malformed, allowing validators to keep collecting independent failures
// instead of throwing on the first one.

interface StringOptions {
  readonly required?: boolean;
  readonly allowEmpty?: boolean;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  options: StringOptions = {},
): string | null {
  const { required = true, allowEmpty = false } = options;
  const value = record[key];
  const path = childPath(parentPath, key);

  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, 'missing_property', `Missing required string property "${key}".`);
    }
    return null;
  }

  if (typeof value !== 'string') {
    pushIssue(
      issues,
      path,
      'expected_string',
      `Expected "${key}" to be a string; received ${describeValue(value)}.`,
    );
    return null;
  }

  if (!allowEmpty && value.trim().length === 0) {
    pushIssue(issues, path, 'empty_string', `Expected "${key}" to be a non-empty string.`);
    return null;
  }

  return value;
}

interface NumberOptions {
  readonly required?: boolean;
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  options: NumberOptions = {},
): number | null {
  const { required = true, integer = false, min, max } = options;
  const value = record[key];
  const path = childPath(parentPath, key);

  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, 'missing_property', `Missing required numeric property "${key}".`);
    }
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    pushIssue(
      issues,
      path,
      'expected_number',
      `Expected "${key}" to be a finite number; received ${describeValue(value)}.`,
    );
    return null;
  }

  if (integer && !Number.isInteger(value)) {
    pushIssue(issues, path, 'expected_integer', `Expected "${key}" to be an integer.`);
    return null;
  }

  if (min !== undefined && value < min) {
    pushIssue(issues, path, 'out_of_range', `Expected "${key}" to be at least ${min}.`);
    return null;
  }

  if (max !== undefined && value > max) {
    pushIssue(issues, path, 'out_of_range', `Expected "${key}" to be at most ${max}.`);
    return null;
  }

  return value;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  required = true,
): boolean | null {
  const value = record[key];
  const path = childPath(parentPath, key);

  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, 'missing_property', `Missing required boolean property "${key}".`);
    }
    return null;
  }

  if (typeof value !== 'boolean') {
    pushIssue(
      issues,
      path,
      'expected_boolean',
      `Expected "${key}" to be a boolean; received ${describeValue(value)}.`,
    );
    return null;
  }

  return value;
}

function readArray(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  required = true,
): unknown[] | null {
  const value = record[key];
  const path = childPath(parentPath, key);

  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, 'missing_property', `Missing required array property "${key}".`);
    }
    return null;
  }

  if (!Array.isArray(value)) {
    pushIssue(
      issues,
      path,
      'expected_array',
      `Expected "${key}" to be an array; received ${describeValue(value)}.`,
    );
    return null;
  }

  return value;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  required = true,
): Record<string, unknown> | null {
  const value = record[key];
  const path = childPath(parentPath, key);

  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, 'missing_property', `Missing required object property "${key}".`);
    }
    return null;
  }

  if (!isRecord(value)) {
    pushIssue(
      issues,
      path,
      'expected_object',
      `Expected "${key}" to be an object; received ${describeValue(value)}.`,
    );
    return null;
  }

  return value;
}

interface StringArrayOptions {
  readonly required?: boolean;
  readonly allowEmptyItems?: boolean;
  readonly unique?: boolean;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  options: StringArrayOptions = {},
): string[] | null {
  const {
    required = true,
    allowEmptyItems = false,
    unique = false,
  } = options;

  const values = readArray(record, key, parentPath, issues, required);
  if (values === null) {
    return null;
  }

  const path = childPath(parentPath, key);
  const seen = new Set<string>();
  const validValues: string[] = [];

  values.forEach((value, index) => {
    const itemPath = childPath(path, index);

    if (typeof value !== 'string') {
      pushIssue(
        issues,
        itemPath,
        'expected_string',
        `Expected array entry to be a string; received ${describeValue(value)}.`,
      );
      return;
    }

    if (!allowEmptyItems && value.trim().length === 0) {
      pushIssue(issues, itemPath, 'empty_string', 'Array entries must be non-empty strings.');
      return;
    }

    if (unique && seen.has(value)) {
      pushIssue(issues, itemPath, 'duplicate_value', `Duplicate value "${value}".`);
      return;
    }

    seen.add(value);
    validValues.push(value);
  });

  return validValues.length === values.length ? validValues : null;
}

/**
 * Collects well-formed string IDs from an array of records while reporting
 * duplicates. Returns the set of IDs for referential cross-checks.
 *
 * IDs on otherwise-invalid entities are still collected so that one broken
 * template does not cascade into spurious "unresolved reference" errors on
 * cards that point at it.
 */
function collectUniqueIds(
  values: readonly unknown[],
  key: string,
  basePath: string,
  issues: ValidationIssue[],
  label: string,
): ReadonlySet<string> {
  const ids = new Set<string>();

  values.forEach((value, index) => {
    if (!isRecord(value)) {
      return;
    }

    const id = value[key];
    if (typeof id !== 'string' || id.trim().length === 0) {
      return;
    }

    if (ids.has(id)) {
      pushIssue(
        issues,
        childPath(childPath(basePath, index), key),
        'duplicate_id',
        `Duplicate ${label} id "${id}".`,
      );
      return;
    }

    ids.add(id);
  });

  return ids;
}

function validateOptionalDate(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
): void {
  if (record[key] === undefined) {
    return;
  }

  const value = readString(record, key, parentPath, issues);
  if (value !== null && !isValidIso8601Date(value)) {
    pushIssue(
      issues,
      childPath(parentPath, key),
      'invalid_literal',
      `"${key}" must be an ISO-8601 date (YYYY-MM-DD) or date-time string when present.`,
    );
  }
}

// ==========================================
// FIELD SCHEMA VALIDATION
// ==========================================

/**
 * Validates a runtime-configured `FieldType` variant.
 *
 * The `switch` is exhaustive over the discriminated union (`text`, `number`,
 * `boolean`, `enum`, `list`); adding a new variant without updating this
 * validator is a compile-time error.
 */
function checkFieldType(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  depth = 0,
): value is FieldType {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Field type must be an object with a "type" discriminator.');
    return false;
  }

  const kind = value.type;
  const kindPath = childPath(path, 'type');

  if (typeof kind !== 'string') {
    pushIssue(issues, kindPath, 'expected_string', 'Field type discriminator must be a string.');
    return false;
  }

  if (!isFieldTypeKind(kind)) {
    pushIssue(issues, kindPath, 'invalid_literal', `Unsupported field type "${kind}".`);
    return false;
  }

  switch (kind) {
    case 'text':
    case 'number':
    case 'boolean':
      break;

    case 'enum': {
      const options = readArray(value, 'options', path, issues);
      if (options !== null) {
        const optionsPath = childPath(path, 'options');

        if (options.length === 0) {
          pushIssue(
            issues,
            optionsPath,
            'invalid_literal',
            'Enum field types must declare at least one option.',
          );
        }

        const seen = new Set<string>();
        options.forEach((option, index) => {
          const optionPath = childPath(optionsPath, index);
          if (typeof option !== 'string' || option.trim().length === 0) {
            pushIssue(issues, optionPath, 'invalid_literal', 'Enum options must be non-empty strings.');
            return;
          }
          if (seen.has(option)) {
            pushIssue(issues, optionPath, 'duplicate_value', `Duplicate enum option "${option}".`);
            return;
          }
          seen.add(option);
        });
      }
      break;
    }

    case 'list': {
      const itemType = value.itemType;
      if (itemType !== 'text' && itemType !== 'number') {
        pushIssue(
          issues,
          childPath(path, 'itemType'),
          'invalid_literal',
          'List field itemType must be "text" or "number".',
        );
      }
      break;
    }

    case 'structured': {
      const children = readArray(value, 'children', path, issues);
      if (children === null) {
        break;
      }

      const childrenPath = childPath(path, 'children');
      if (children.length === 0) {
        pushIssue(
          issues,
          childrenPath,
          'invalid_literal',
          'Structured field types must declare at least one child field.',
        );
      }

      collectUniqueIds(children, 'key', childrenPath, issues, 'structured child');

      children.forEach((child, index) => {
        const childPathValue = childPath(childrenPath, index);

        if (!isRecord(child)) {
          pushIssue(
            issues,
            childPathValue,
            'expected_object',
            'Structured child definitions must be objects.',
          );
          return;
        }

        readString(child, 'key', childPathValue, issues);
        readString(child, 'label', childPathValue, issues);

        const childType = child.type;
        const childTypePath = childPath(childPathValue, 'type');
        const childIsStructured =
          isRecord(childType) && childType.type === 'structured';

        if (childIsStructured && depth + 1 >= MAX_STRUCTURED_DEPTH) {
          pushIssue(
            issues,
            childTypePath,
            'invalid_literal',
            `Structured fields cannot nest deeper than ${MAX_STRUCTURED_DEPTH} levels.`,
          );
        } else {
          const childTypeValid = checkFieldType(
            childType,
            childTypePath,
            issues,
            depth + 1,
          );

          if (
            childTypeValid &&
            childType.type !== 'structured' &&
            child.defaultValue !== undefined
          ) {
            validateValueAgainstFieldType(
              childType,
              child.defaultValue,
              childPath(childPathValue, 'defaultValue'),
              issues,
              'invalid_default_value',
              `Default value for structured child "${String(child.key)}"`,
              depth + 1,
            );
          } else if (
            childTypeValid &&
            childType.type === 'structured' &&
            child.defaultValue !== undefined
          ) {
            validateValueAgainstFieldType(
              childType,
              child.defaultValue,
              childPath(childPathValue, 'defaultValue'),
              issues,
              'invalid_default_value',
              `Default value for structured child "${String(child.key)}"`,
              depth + 1,
            );
          }
        }

        if (child.required !== undefined) {
          readBoolean(child, 'required', childPathValue, issues, false);
        }
      });
      break;
    }

    default:
      return assertNever(kind);
  }

  return issues.length === start;
}

/**
 * Validates a single field definition, including its optional default value.
 */
function checkFieldDefinition(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is FieldDefinition {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Field definition must be an object.');
    return false;
  }

  readString(value, 'key', path, issues);
  readString(value, 'label', path, issues);

  const target = value.target;
  if (typeof target !== 'string' || !isFieldTarget(target)) {
    pushIssue(
      issues,
      childPath(path, 'target'),
      'invalid_literal',
      'Field target must be "face" or "root".',
    );
  }

  const fieldType = value.type;
  const fieldTypePath = childPath(path, 'type');

  if (checkFieldType(fieldType, fieldTypePath, issues) && value.defaultValue !== undefined) {
    validateValueAgainstFieldType(
      fieldType,
      value.defaultValue,
      childPath(path, 'defaultValue'),
      issues,
      'invalid_default_value',
      `Default value for field "${String(value.key)}"`,
    );
  }

  if (value.required !== undefined) {
    readBoolean(value, 'required', path, issues, false);
  }

  if (value.cardTypes !== undefined) {
    readStringArray(value, 'cardTypes', path, issues, { unique: true });
  }

  return issues.length === start;
}

/**
 * Validates a record value against its declared `FieldType`.
 *
 * Used both for defaults (`invalid_default_value`) and for concrete card
 * attribute values (`invalid_field_value`) so both paths share one exhaustive
 * type check.
 */
function validateValueAgainstFieldType(
  fieldType: FieldType,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  code: ValidationIssueCode,
  context: string,
  depth = 0,
): boolean {
  switch (fieldType.type) {
    case 'text':
      if (typeof value === 'string') {
        return true;
      }
      pushIssue(issues, path, code, `${context} must be a string.`);
      return false;

    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return true;
      }
      pushIssue(issues, path, code, `${context} must be a finite number.`);
      return false;

    case 'boolean':
      if (typeof value === 'boolean') {
        return true;
      }
      pushIssue(issues, path, code, `${context} must be a boolean.`);
      return false;

    case 'enum':
      if (typeof value === 'string' && fieldType.options.includes(value)) {
        return true;
      }
      pushIssue(
        issues,
        path,
        code,
        `${context} must be one of: ${fieldType.options.join(', ')}.`,
      );
      return false;

    case 'list': {
      if (!Array.isArray(value)) {
        pushIssue(issues, path, code, `${context} must be an array of ${fieldType.itemType} values.`);
        return false;
      }

      let valid = true;
      value.forEach((item, index) => {
        const itemPath = childPath(path, index);
        if (fieldType.itemType === 'text') {
          if (typeof item !== 'string') {
            pushIssue(issues, itemPath, code, `${context} entries must be strings.`);
            valid = false;
          }
          return;
        }

        if (typeof item !== 'number' || !Number.isFinite(item)) {
          pushIssue(issues, itemPath, code, `${context} entries must be finite numbers.`);
          valid = false;
        }
      });
      return valid;
    }

    case 'structured': {
      if (!Array.isArray(value)) {
        pushIssue(
          issues,
          path,
          code,
          `${context} must be an array of structured entries.`,
        );
        return false;
      }

      if (value.length > 100) {
        pushIssue(
          issues,
          path,
          'out_of_range',
          `${context} must contain at most 100 entries.`,
        );
        return false;
      }

      const childrenByKey = new Map(
        fieldType.children.map((child) => [child.key, child]),
      );
      const seenEntryIds = new Set<string>();
      let valid = true;

      value.forEach((entry, index) => {
        const entryPath = childPath(path, index);

        if (!isRecord(entry)) {
          pushIssue(
            issues,
            entryPath,
            code,
            `${context} entries must be objects.`,
          );
          valid = false;
          return;
        }

        const entryId = entry.entryId;
        if (typeof entryId !== 'string' || entryId.trim().length === 0) {
          pushIssue(
            issues,
            childPath(entryPath, 'entryId'),
            code,
            `${context} entries must declare a non-empty entryId.`,
          );
          valid = false;
        } else if (seenEntryIds.has(entryId)) {
          pushIssue(
            issues,
            childPath(entryPath, 'entryId'),
            'duplicate_id',
            `Duplicate structured entry id "${entryId}".`,
          );
          valid = false;
        } else {
          seenEntryIds.add(entryId);
        }

        const values = entry.values;
        if (!isRecord(values)) {
          pushIssue(
            issues,
            childPath(entryPath, 'values'),
            code,
            `${context} entries must contain a values object.`,
          );
          valid = false;
          return;
        }

        for (const child of fieldType.children) {
          const childValue = values[child.key];
          const childValuePath = childPath(
            childPath(entryPath, 'values'),
            child.key,
          );

          if (childValue === undefined) {
            if (child.required === true) {
              pushIssue(
                issues,
                childValuePath,
                code,
                `${context} entry is missing required child "${child.label}".`,
              );
              valid = false;
            }
            continue;
          }

          if (
            !validateValueAgainstFieldType(
              child.type,
              childValue,
              childValuePath,
              issues,
              code,
              `Entry child "${child.label}"`,
              depth + 1,
            )
          ) {
            valid = false;
          }
        }

        for (const key of Object.keys(values)) {
          if (!childrenByKey.has(key)) {
            pushIssue(
              issues,
              childPath(childPath(entryPath, 'values'), key),
              'unknown_field',
              `Unknown structured child key "${key}".`,
            );
            valid = false;
          }
        }
      });

      return valid;
    }

    default:
      return assertNever(fieldType);
  }
}

/**
 * Validates attribute values when the active profile is unavailable (for
 * example because the profile itself failed validation). Only the JSON value
 * domain is enforced; profile-specific field constraints cannot be checked.
 */
function isLooseScalarValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === 'string' ||
          (typeof item === 'number' && Number.isFinite(item)),
      ))
  );
}

function isLooseAttributeValue(value: unknown): boolean {
  if (isLooseScalarValue(value)) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((item) => {
    if (!isRecord(item)) {
      return false;
    }

    return (
      typeof item.entryId === 'string' &&
      item.entryId.trim().length > 0 &&
      isRecord(item.values) &&
      Object.values(item.values).every(isLooseAttributeValue)
    );
  });
}

function validateLooseAttributeValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (isLooseAttributeValue(value)) {
    return;
  }

  pushIssue(
    issues,
    path,
    'invalid_field_value',
    'Attribute values must be scalar values, scalar arrays, or structured entry arrays; nested structured values must keep valid entry ids.',
  );
}

/**
 * Validates a root- or face-attribute bag against the active game profile.
 *
 * Every key must map to a field definition with the matching target; all
 * `required` fields must be present; and every value must satisfy its declared
 * field type.
 */
function validateAttributeBag(
  value: Record<string, unknown>,
  target: FieldDefinition['target'],
  cardType: string | null,
  profile: GameProfile | null,
  path: string,
  issues: ValidationIssue[],
): void {
  if (profile === null) {
    for (const [key, attributeValue] of Object.entries(value)) {
      validateLooseAttributeValue(attributeValue, childPath(path, key), issues);
    }
    return;
  }

  const allDefinitionsByKey = new Map<string, FieldDefinition>();
  const definitionsByKey = new Map<string, FieldDefinition>();
  for (const definition of profile.fieldDefinitions) {
    if (definition.target !== target) {
      continue;
    }

    allDefinitionsByKey.set(definition.key, definition);
    if (isFieldApplicableToCardType(definition, cardType)) {
      definitionsByKey.set(definition.key, definition);
    }
  }

  for (const definition of definitionsByKey.values()) {
    if (definition.required === true && !Object.hasOwn(value, definition.key)) {
      pushIssue(
        issues,
        childPath(path, definition.key),
        'missing_required_field',
        `Missing required ${target} field "${definition.key}".`,
      );
    }
  }

  for (const [key, attributeValue] of Object.entries(value)) {
    const definition = definitionsByKey.get(key);
    const attributePath = childPath(path, key);

    if (definition === undefined) {
      const knownDefinition = allDefinitionsByKey.get(key);
      const message =
        knownDefinition === undefined
          ? `Attribute "${key}" is not a ${target}-targeted field in the active game profile.`
          : `Attribute "${key}" is not applicable to card type "${cardType ?? 'unknown'}".`;
      pushIssue(issues, attributePath, 'unknown_field', message);
      continue;
    }

    validateValueAgainstFieldType(
      definition.type,
      attributeValue,
      attributePath,
      issues,
      'invalid_field_value',
      `Attribute "${key}"`,
    );
  }
}

function isFieldApplicableToCardType(
  definition: FieldDefinition,
  cardType: string | null,
): boolean {
  if (
    definition.cardTypes === undefined ||
    definition.cardTypes.length === 0 ||
    cardType === null
  ) {
    return true;
  }

  return definition.cardTypes.includes(cardType);
}

// ==========================================
// LAYER 1: GAME PROFILE
// ==========================================

function checkGameProfile(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is GameProfile {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Game profile must be an object.');
    return false;
  }

  readString(value, 'id', path, issues);
  readString(value, 'name', path, issues);
  const cardTypes = readStringArray(value, 'cardTypes', path, issues, {
    unique: true,
  });
  readStringArray(value, 'subtypes', path, issues, { unique: true });
  readStringArray(value, 'keywords', path, issues, { unique: true });

  const fieldDefinitions = readArray(value, 'fieldDefinitions', path, issues);
  if (fieldDefinitions !== null) {
    const definitionsPath = childPath(path, 'fieldDefinitions');
    collectUniqueIds(fieldDefinitions, 'key', definitionsPath, issues, 'field definition');

    fieldDefinitions.forEach((definition, index) => {
      const definitionPath = childPath(definitionsPath, index);
      checkFieldDefinition(definition, definitionPath, issues);

      if (
        cardTypes !== null &&
        isRecord(definition) &&
        Array.isArray(definition.cardTypes)
      ) {
        definition.cardTypes.forEach((cardType, typeIndex) => {
          if (typeof cardType === 'string' && !cardTypes.includes(cardType)) {
            pushIssue(
              issues,
              childPath(childPath(definitionPath, 'cardTypes'), typeIndex),
              'invalid_reference',
              `Field card type "${cardType}" is not declared in profile.cardTypes.`,
            );
          }
        });
      }
    });
  }

  const deckRules = readRecord(value, 'deckRules', path, issues);
  if (deckRules !== null) {
    const deckRulesPath = childPath(path, 'deckRules');
    const minSize = readNumber(deckRules, 'minSize', deckRulesPath, issues, {
      integer: true,
      min: 0,
    });
    const maxSize = readNumber(deckRules, 'maxSize', deckRulesPath, issues, {
      integer: true,
      min: 0,
    });
    readNumber(deckRules, 'maxCopiesPerCard', deckRulesPath, issues, {
      integer: true,
      min: 1,
    });

    if (minSize !== null && maxSize !== null && minSize > maxSize) {
      pushIssue(
        issues,
        childPath(deckRulesPath, 'maxSize'),
        'out_of_range',
        `deckRules.maxSize (${maxSize}) must be greater than or equal to minSize (${minSize}).`,
      );
    }
  }

  return issues.length === start;
}

/**
 * Runtime validation for a standalone `GameProfile`.
 *
 * Profile setup and IndexedDB hydration both use this entry point so stored
 * data is treated as untrusted until every field type and default has been
 * checked.
 */
export function validateGameProfile(
  data: unknown,
): ValidationResult<GameProfile> {
  const issues: ValidationIssue[] = [];

  if (checkGameProfile(data, ROOT_PATH, issues)) {
    return { ok: true, value: data };
  }

  return fail(issues);
}

/** Runtime type guard for a standalone `GameProfile`. */
export function isGameProfile(data: unknown): data is GameProfile {
  const issues: ValidationIssue[] = [];
  return checkGameProfile(data, ROOT_PATH, issues);
}

// ==========================================
// LAYER 2: CARD TEMPLATES
// ==========================================

function checkTemplateBlock(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  fieldDefinitions: readonly FieldDefinition[] | null,
): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Template block must be an object.');
    return;
  }

  readString(value, 'id', path, issues);

  const type = value.type;
  const blockType = typeof type === 'string' && isBlockType(type) ? type : null;
  if (blockType === null) {
    pushIssue(
      issues,
      childPath(path, 'type'),
      'invalid_literal',
      'Template block type must be a supported structural block.',
    );
  }

  const designTokenStyle = value.designTokenStyle;
  if (typeof designTokenStyle !== 'string' || !isDesignTokenId(designTokenStyle)) {
    pushIssue(
      issues,
      childPath(path, 'designTokenStyle'),
      'invalid_literal',
      'designTokenStyle must be a whitelisted design-token id; raw Tailwind class strings are not permitted.',
    );
  }

  if (value.mappingKey !== undefined) {
    const mappingKey = readString(value, 'mappingKey', path, issues);
    if (mappingKey !== null && blockType !== null) {
      const policy = BLOCK_MAPPING_POLICY[blockType];
      const isCoreTarget = policy.coreKeys.includes(mappingKey);
      const fieldDefinition =
        fieldDefinitions?.find(
          (definition) => definition.key === mappingKey,
        ) ?? null;
      const isSupportedField =
        fieldDefinition !== null &&
        policy.fieldTypes.includes(fieldDefinition.type.type) &&
        policy.fieldTargets.includes(fieldDefinition.target);

      if (!isCoreTarget && !isSupportedField) {
        pushIssue(
          issues,
          childPath(path, 'mappingKey'),
          'invalid_reference',
          `mappingKey "${mappingKey}" is not compatible with the ${blockType} block type. Allowed: ${describeBlockMappingPolicy(blockType)}.`,
        );
      }
    }
  }

  if (value.hideWhenEmpty !== undefined) {
    readBoolean(value, 'hideWhenEmpty', path, issues, false);
  }

  readNumber(value, 'order', path, issues, { integer: true, min: 0 });
}

function checkCardTemplate(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  profile: GameProfile | null,
): value is CardTemplate {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Card template must be an object.');
    return false;
  }

  readString(value, 'id', path, issues);
  readString(value, 'name', path, issues);

  const profileId = readString(value, 'profileId', path, issues);
  if (profileId !== null && profile !== null && profileId !== profile.id) {
    pushIssue(
      issues,
      childPath(path, 'profileId'),
      'unresolved_reference',
      `Template profileId "${profileId}" does not match the manifest profile "${profile.id}".`,
    );
  }

  const layout = value.layout;
  if (typeof layout !== 'string' || !isCardLayout(layout)) {
    pushIssue(
      issues,
      childPath(path, 'layout'),
      'invalid_literal',
      'Template layout must be "single", "double_sided", or "split".',
    );
  }

  const fieldDefinitions = profile?.fieldDefinitions ?? null;

  const blocks = readArray(value, 'blocks', path, issues);
  if (blocks !== null) {
    const blocksPath = childPath(path, 'blocks');
    collectUniqueIds(blocks, 'id', blocksPath, issues, 'template block');

    blocks.forEach((block, index) => {
      checkTemplateBlock(
        block,
        childPath(blocksPath, index),
        issues,
        fieldDefinitions,
      );
    });
  }

  return issues.length === start;
}

export interface CardTemplateValidationOptions {
  /** JSON-path-like location used in reported issues. */
  readonly path?: string;
  /** Active profile used to validate ownership and mapping keys. */
  readonly profile?: GameProfile | null;
}

/**
 * Validates one template record, including block types, design-token IDs,
 * block ordering, unique block IDs, and mapping keys. Reused by persistence
 * and import validation so both enforce the same rendering contract.
 */
export function validateCardTemplateRecord(
  value: unknown,
  options: CardTemplateValidationOptions = {},
): ValidationResult<CardTemplate> {
  const issues: ValidationIssue[] = [];

  if (
    !checkCardTemplate(
      value,
      options.path ?? ROOT_PATH,
      issues,
      options.profile ?? null,
    )
  ) {
    return fail(issues);
  }

  return { ok: true, value };
}

// ==========================================
// LAYER 3: CARD RECORDS & FACES
// ==========================================

function checkCardFace(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  profile: GameProfile | null,
  assetIds: ReadonlySet<string> | null,
  parentCardType: string | null,
): value is CardFace {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Card face must be an object.');
    return false;
  }

  readString(value, 'faceId', path, issues);

  if (value.name !== undefined) {
    readString(value, 'name', path, issues, { allowEmpty: true });
  }

  let faceCardType: string | null = null;
  if (value.cardType !== undefined) {
    faceCardType = readString(value, 'cardType', path, issues);
    if (
      faceCardType !== null &&
      profile !== null &&
      !profile.cardTypes.includes(faceCardType)
    ) {
      pushIssue(
        issues,
        childPath(path, 'cardType'),
        'invalid_reference',
        `Face card type "${faceCardType}" is not declared in profile.cardTypes.`,
      );
    }
  }

  if (value.subtypes !== undefined) {
    const faceSubtypes = readStringArray(value, 'subtypes', path, issues, {
      unique: true,
    });
    if (faceSubtypes !== null && profile !== null) {
      const allowedSubtypes = new Set(profile.subtypes);
      const subtypesPath = childPath(path, 'subtypes');
      faceSubtypes.forEach((subtype, index) => {
        if (!allowedSubtypes.has(subtype)) {
          pushIssue(
            issues,
            childPath(subtypesPath, index),
            'invalid_reference',
            `Subtype "${subtype}" is not declared in profile.subtypes.`,
          );
        }
      });
    }
  }

  readString(value, 'rulesText', path, issues, { allowEmpty: true });

  if (value.flavorText !== undefined) {
    readString(value, 'flavorText', path, issues, { allowEmpty: true });
  }

  const artAssetId = value.artAssetId;
  const artAssetPath = childPath(path, 'artAssetId');

  if (artAssetId === undefined) {
    pushIssue(
      issues,
      artAssetPath,
      'missing_property',
      'Card face must declare artAssetId (a content-hash string or null).',
    );
  } else if (artAssetId !== null) {
    if (typeof artAssetId !== 'string' || !isContentHashId(artAssetId)) {
      pushIssue(
        issues,
        artAssetPath,
        'invalid_content_hash',
        'artAssetId must be a lowercase 64-character SHA-256 hex digest or null.',
      );
    } else if (assetIds !== null && !assetIds.has(artAssetId)) {
      pushIssue(
        issues,
        artAssetPath,
        'unresolved_reference',
        `artAssetId "${artAssetId}" has no matching asset reference in this manifest. Missing local image bytes are allowed, but the manifest reference must exist.`,
      );
    }
  }

  if (value.fullCardAssetId !== undefined && value.fullCardAssetId !== null) {
    const fullCardAssetPath = childPath(path, 'fullCardAssetId');
    const fullCardAssetId = value.fullCardAssetId;

    if (
      typeof fullCardAssetId !== 'string' ||
      !isContentHashId(fullCardAssetId)
    ) {
      pushIssue(
        issues,
        fullCardAssetPath,
        'invalid_content_hash',
        'fullCardAssetId must be a lowercase 64-character SHA-256 hex digest or null.',
      );
    } else if (assetIds !== null && !assetIds.has(fullCardAssetId)) {
      pushIssue(
        issues,
        fullCardAssetPath,
        'unresolved_reference',
        `fullCardAssetId "${fullCardAssetId}" has no matching asset reference in this manifest.`,
      );
    }
  }

  const faceAttributes = readRecord(value, 'faceAttributes', path, issues);
  if (faceAttributes !== null) {
    validateAttributeBag(
      faceAttributes,
      'face',
      faceCardType ?? parentCardType,
      profile,
      childPath(path, 'faceAttributes'),
      issues,
    );
  }

  return issues.length === start;
}

interface CardRecordValidationContext {
  readonly profile: GameProfile | null;
  readonly templateIds: ReadonlySet<string> | null;
  readonly assetIds: ReadonlySet<string> | null;
}

function checkCardRecord(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  context: CardRecordValidationContext,
): value is CardRecord {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Card record must be an object.');
    return false;
  }

  readString(value, 'id', path, issues);
  readString(value, 'name', path, issues);

  const profileId = readString(value, 'profileId', path, issues);
  if (profileId !== null && context.profile !== null && profileId !== context.profile.id) {
    pushIssue(
      issues,
      childPath(path, 'profileId'),
      'unresolved_reference',
      `Card profileId "${profileId}" does not match the manifest profile "${context.profile.id}".`,
    );
  }

  const templateId = readString(value, 'templateId', path, issues);
  if (
    templateId !== null &&
    context.templateIds !== null &&
    !context.templateIds.has(templateId)
  ) {
    pushIssue(
      issues,
      childPath(path, 'templateId'),
      'unresolved_reference',
      `Card templateId "${templateId}" does not reference a template in this manifest.`,
    );
  }

  const cardType = readString(value, 'cardType', path, issues);
  if (cardType !== null && context.profile !== null) {
    if (!context.profile.cardTypes.includes(cardType)) {
      pushIssue(
        issues,
        childPath(path, 'cardType'),
        'invalid_reference',
        `Card type "${cardType}" is not declared in profile.cardTypes.`,
      );
    }
  }

  const subtypes = readStringArray(value, 'subtypes', path, issues, { unique: true });
  if (subtypes !== null && context.profile !== null) {
    const allowedSubtypes = new Set(context.profile.subtypes);
    const subtypesPath = childPath(path, 'subtypes');
    subtypes.forEach((subtype, index) => {
      if (!allowedSubtypes.has(subtype)) {
        pushIssue(
          issues,
          childPath(subtypesPath, index),
          'invalid_reference',
          `Subtype "${subtype}" is not declared in profile.subtypes.`,
        );
      }
    });
  }

  const faces = readArray(value, 'faces', path, issues);
  if (faces !== null) {
    const facesPath = childPath(path, 'faces');
    if (faces.length === 0) {
      pushIssue(issues, facesPath, 'invalid_literal', 'A card record must expose at least one face.');
    }

    collectUniqueIds(faces, 'faceId', facesPath, issues, 'card face');
    faces.forEach((face, index) => {
      checkCardFace(
        face,
        childPath(facesPath, index),
        issues,
        context.profile,
        context.assetIds,
        cardType,
      );
    });
  }

  const rootAttributes = readRecord(value, 'rootAttributes', path, issues);
  if (rootAttributes !== null) {
    validateAttributeBag(
      rootAttributes,
      'root',
      cardType,
      context.profile,
      childPath(path, 'rootAttributes'),
      issues,
    );
  }

  readStringArray(value, 'tags', path, issues);

  return issues.length === start;
}

// ==========================================
// LAYER 4: PACKS, DECKS & ASSETS
// ==========================================

function checkAssetReference(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is AssetReference {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Asset reference must be an object.');
    return false;
  }

  const assetId = readString(value, 'assetId', path, issues);
  if (assetId !== null && !isContentHashId(assetId)) {
    pushIssue(
      issues,
      childPath(path, 'assetId'),
      'invalid_content_hash',
      'assetId must be a lowercase 64-character SHA-256 hex digest.',
    );
  }

  readString(value, 'fileName', path, issues);
  readString(value, 'mimeType', path, issues);

  if (value.relativePathHint !== undefined) {
    readString(value, 'relativePathHint', path, issues);
  }

  readNumber(value, 'byteSize', path, issues, { integer: true, min: 0 });

  return issues.length === start;
}

function checkCardPack(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  knownCardIds: ReadonlySet<string> | null,
): value is CardPack {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Card pack must be an object.');
    return false;
  }

  readString(value, 'id', path, issues);
  readString(value, 'name', path, issues);
  readString(value, 'description', path, issues, { allowEmpty: true });
  validateOptionalDate(value, 'releaseDate', path, issues);

  const cardIds = readStringArray(value, 'cardIds', path, issues, { unique: true });
  if (cardIds !== null && knownCardIds !== null) {
    const cardIdsPath = childPath(path, 'cardIds');
    cardIds.forEach((cardId, index) => {
      if (!knownCardIds.has(cardId)) {
        pushIssue(
          issues,
          childPath(cardIdsPath, index),
          'unresolved_reference',
          `Pack cardId "${cardId}" does not reference a card in this manifest.`,
        );
      }
    });
  }

  return issues.length === start;
}

interface DeckValidationContext {
  readonly profileId: string | null;
  readonly cardIds: ReadonlySet<string> | null;
}

function checkDeck(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  context: DeckValidationContext,
): value is Deck {
  const start = issues.length;

  if (!isRecord(value)) {
    pushIssue(issues, path, 'expected_object', 'Deck must be an object.');
    return false;
  }

  readString(value, 'id', path, issues);
  readString(value, 'name', path, issues);
  readString(value, 'format', path, issues);

  const profileId = readString(value, 'profileId', path, issues);
  if (profileId !== null && context.profileId !== null && profileId !== context.profileId) {
    pushIssue(
      issues,
      childPath(path, 'profileId'),
      'unresolved_reference',
      `Deck profileId "${profileId}" does not match the manifest profile "${context.profileId}".`,
    );
  }

  const entries = readArray(value, 'entries', path, issues);
  if (entries !== null) {
    const entriesPath = childPath(path, 'entries');
    const seenCardIds = new Set<string>();

    entries.forEach((entry, index) => {
      const entryPath = childPath(entriesPath, index);

      if (!isRecord(entry)) {
        pushIssue(issues, entryPath, 'expected_object', 'Deck entry must be an object.');
        return;
      }

      const cardId = readString(entry, 'cardId', entryPath, issues);
      readNumber(entry, 'count', entryPath, issues, { integer: true, min: 1 });

      if (cardId === null) {
        return;
      }

      if (context.cardIds !== null && !context.cardIds.has(cardId)) {
        pushIssue(
          issues,
          childPath(entryPath, 'cardId'),
          'unresolved_reference',
          `Deck entry cardId "${cardId}" does not reference a card in this manifest.`,
        );
      }

      if (seenCardIds.has(cardId)) {
        pushIssue(
          issues,
          childPath(entryPath, 'cardId'),
          'duplicate_value',
          `Deck contains multiple entries for card "${cardId}"; combine them into one entry.`,
        );
        return;
      }

      seenCardIds.add(cardId);
    });
  }

  readStringArray(value, 'tags', path, issues);

  return issues.length === start;
}

export interface AssetReferenceValidationOptions {
  /** JSON-path-like location used in reported issues. */
  readonly path?: string;
}

/** Validates one asset-reference record in isolation. */
export function validateAssetReferenceRecord(
  value: unknown,
  options: AssetReferenceValidationOptions = {},
): ValidationResult<AssetReference> {
  const issues: ValidationIssue[] = [];

  if (!checkAssetReference(value, options.path ?? ROOT_PATH, issues)) {
    return fail(issues);
  }

  return { ok: true, value };
}

/** Binary payload accepted for content-hash verification. */
export type AssetBinaryPayload = ArrayBuffer | Uint8Array;

/** Runtime guard for binary payloads accepted by asset verification/storage. */
export function isAssetBinaryPayload(
  value: unknown,
): value is AssetBinaryPayload {
  return value instanceof ArrayBuffer || value instanceof Uint8Array;
}

/**
 * Computes the lowercase SHA-256 hex digest used as an asset's content
 * identity. Requires Web Crypto (`crypto.subtle`) in the host environment.
 */
export async function computeSha256Hex(
  bytes: AssetBinaryPayload,
): Promise<string> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
    throw new Error(
      'Web Crypto SHA-256 is not available in this environment.',
    );
  }

  // The copy guarantees an ArrayBuffer-backed view rather than a potentially
  // SharedArrayBuffer-backed view, which Web Crypto's BufferSource rejects.
  const payload = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', payload);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export interface AssetBytesValidationOptions {
  /** JSON-path-like location used in reported issues. */
  readonly path?: string;
}

/**
 * Verifies that actual image bytes match an asset reference's content hash and
 * declared byte size. Metadata validation alone cannot prove the bytes are the
 * asset the manifest claims; callers must run this before rendering artwork or
 * accepting bytes from an imported archive.
 */
export async function validateAssetBytes(
  reference: unknown,
  bytes: unknown,
  options: AssetBytesValidationOptions = {},
): Promise<ValidationResult<AssetReference>> {
  const path = options.path ?? ROOT_PATH;
  const issues: ValidationIssue[] = [];
  const referenceResult = validateAssetReferenceRecord(reference, { path });

  if (!referenceResult.ok) {
    issues.push(...referenceResult.issues);
  }

  if (!isAssetBinaryPayload(bytes)) {
    issues.push({
      path: childPath(path, 'bytes'),
      code: 'expected_binary_data',
      message: 'Asset bytes must be an ArrayBuffer or Uint8Array.',
    });
    return fail(issues);
  }

  if (!referenceResult.ok) {
    return fail(issues);
  }

  const asset = referenceResult.value;

  if (bytes.byteLength !== asset.byteSize) {
    issues.push({
      path: childPath(path, 'byteSize'),
      code: 'byte_size_mismatch',
      message: `Asset bytes are ${bytes.byteLength} bytes, but the reference declares ${asset.byteSize}.`,
    });
  }

  const actualHash = await computeSha256Hex(bytes);
  if (actualHash !== asset.assetId) {
    issues.push({
      path: childPath(path, 'assetId'),
      code: 'content_hash_mismatch',
      message: `Asset bytes hash to "${actualHash}", which does not match assetId "${asset.assetId}".`,
    });
  }

  return issues.length === 0 ? { ok: true, value: asset } : fail(issues);
}

export interface CardPackValidationOptions {
  /** JSON-path-like location used in reported issues. */
  readonly path?: string;
  /** Card IDs available for `cardIds` reference checks. */
  readonly knownCardIds?: ReadonlySet<string> | null;
}

/** Validates one pack record, including card references when supplied. */
export function validateCardPackRecord(
  value: unknown,
  options: CardPackValidationOptions = {},
): ValidationResult<CardPack> {
  const issues: ValidationIssue[] = [];

  if (
    !checkCardPack(
      value,
      options.path ?? ROOT_PATH,
      issues,
      options.knownCardIds ?? null,
    )
  ) {
    return fail(issues);
  }

  return { ok: true, value };
}

export interface DeckValidationOptions {
  /** JSON-path-like location used in reported issues. */
  readonly path?: string;
  /** Expected owning profile; mismatches are unresolved references. */
  readonly profileId?: string | null;
  /** Card IDs available for entry reference checks. */
  readonly knownCardIds?: ReadonlySet<string> | null;
}

/** Validates one deck record, including profile and card references. */
export function validateDeckRecord(
  value: unknown,
  options: DeckValidationOptions = {},
): ValidationResult<Deck> {
  const issues: ValidationIssue[] = [];

  if (
    !checkDeck(value, options.path ?? ROOT_PATH, issues, {
      profileId: options.profileId ?? null,
      cardIds: options.knownCardIds ?? null,
    })
  ) {
    return fail(issues);
  }

  return { ok: true, value };
}

// ==========================================
// MANIFEST GUARD
// ==========================================

function validateSchemaVersion(
  record: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  const path = childPath(ROOT_PATH, 'schemaVersion');
  const value = record.schemaVersion;

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    pushIssue(
      issues,
      path,
      'invalid_version',
      `Manifest schemaVersion must be an integer; received ${describeValue(value)}.`,
    );
    return;
  }

  if (value < MIN_SUPPORTED_SCHEMA_VERSION) {
    pushIssue(
      issues,
      path,
      'invalid_version',
      `Manifest schemaVersion ${value} is older than the minimum supported version ${MIN_SUPPORTED_SCHEMA_VERSION}.`,
    );
    return;
  }

  if (value > CURRENT_SCHEMA_VERSION) {
    pushIssue(
      issues,
      path,
      'unsupported_version',
      `Manifest schemaVersion ${value} is newer than the supported version ${CURRENT_SCHEMA_VERSION}.`,
    );
    return;
  }

  if (value < CURRENT_SCHEMA_VERSION) {
    pushIssue(
      issues,
      path,
      'migration_required',
      `Manifest schemaVersion ${value} must be migrated to ${CURRENT_SCHEMA_VERSION} before use.`,
    );
  }
}

/**
 * Structural and referential validation for the current schema version.
 *
 * Returns a type predicate so the public result helpers can narrow `data`
 * without an unsafe assertion.
 */
function checkProjectManifest(
  data: unknown,
  issues: ValidationIssue[],
): data is ProjectManifest {
  const start = issues.length;

  if (!isRecord(data)) {
    pushIssue(issues, ROOT_PATH, 'expected_object', 'Project manifest must be a JSON object.');
    return false;
  }

  validateSchemaVersion(data, issues);

  readString(data, 'projectId', ROOT_PATH, issues);
  readString(data, 'projectName', ROOT_PATH, issues);
  validateOptionalDate(data, 'createdAt', ROOT_PATH, issues);
  validateOptionalDate(data, 'updatedAt', ROOT_PATH, issues);

  const profileValue = data.profile;
  const profile: GameProfile | null = checkGameProfile(
    profileValue,
    childPath(ROOT_PATH, 'profile'),
    issues,
  )
    ? profileValue
    : null;

  const assets = readArray(data, 'assets', ROOT_PATH, issues);
  const assetIds = assets === null
    ? null
    : collectUniqueIds(
        assets,
        'assetId',
        childPath(ROOT_PATH, 'assets'),
        issues,
        'asset',
      );

  if (assets !== null) {
    const assetsPath = childPath(ROOT_PATH, 'assets');
    assets.forEach((asset, index) => {
      checkAssetReference(asset, childPath(assetsPath, index), issues);
    });
  }

  const templates = readArray(data, 'templates', ROOT_PATH, issues);
  const templateIds = templates === null
    ? null
    : collectUniqueIds(
        templates,
        'id',
        childPath(ROOT_PATH, 'templates'),
        issues,
        'template',
      );

  if (templates !== null) {
    const templatesPath = childPath(ROOT_PATH, 'templates');
    templates.forEach((template, index) => {
      checkCardTemplate(template, childPath(templatesPath, index), issues, profile);
    });
  }

  const cards = readArray(data, 'cards', ROOT_PATH, issues);
  const cardIds = cards === null
    ? null
    : collectUniqueIds(
        cards,
        'id',
        childPath(ROOT_PATH, 'cards'),
        issues,
        'card',
      );

  if (cards !== null) {
    const cardsPath = childPath(ROOT_PATH, 'cards');
    cards.forEach((card, index) => {
      checkCardRecord(card, childPath(cardsPath, index), issues, {
        profile,
        templateIds,
        assetIds,
      });
    });
  }

  const packs = readArray(data, 'packs', ROOT_PATH, issues);
  if (packs !== null) {
    const packsPath = childPath(ROOT_PATH, 'packs');
    collectUniqueIds(packs, 'id', packsPath, issues, 'pack');
    packs.forEach((pack, index) => {
      checkCardPack(pack, childPath(packsPath, index), issues, cardIds);
    });
  }

  const decks = readArray(data, 'decks', ROOT_PATH, issues);
  if (decks !== null) {
    const decksPath = childPath(ROOT_PATH, 'decks');
    collectUniqueIds(decks, 'id', decksPath, issues, 'deck');
    decks.forEach((deck, index) => {
      checkDeck(deck, childPath(decksPath, index), issues, {
        profileId: profile?.id ?? null,
        cardIds,
      });
    });
  }

  return issues.length === start;
}

/**
 * Full runtime validation of an untrusted project manifest.
 *
 * Rejects manifests that require migration (`migration_required`); use
 * {@link migrateProjectManifest} to upgrade older payloads first.
 *
 * @param data Untrusted value, typically the result of `JSON.parse`.
 */
export function validateProjectManifest(
  data: unknown,
): ValidationResult<ProjectManifest> {
  const issues: ValidationIssue[] = [];

  if (checkProjectManifest(data, issues)) {
    return { ok: true, value: data };
  }

  return fail(issues);
}

/**
 * Runtime type guard for the current `ProjectManifest` schema.
 *
 * Performs the same full validation as {@link validateProjectManifest} and is
 * safe to use directly in `if` conditions before hydrating state.
 */
export function isProjectManifest(data: unknown): data is ProjectManifest {
  const issues: ValidationIssue[] = [];
  return checkProjectManifest(data, issues);
}

/**
 * Default import-boundary size limit (50 MiB of UTF-8 JSON text).
 *
 * This guards the main thread against accidentally opening a huge file. It can
 * be overridden per call for tests or specialised imports.
 */
export const DEFAULT_MAX_MANIFEST_BYTES = 50 * 1024 * 1024;

export interface ParseProjectManifestOptions {
  readonly maxBytes?: number;
}

/**
 * Parses JSON text and validates it against the current manifest schema.
 *
 * Uses the migration pipeline so older, supported manifests are upgraded
 * before validation. Parse failures are reported as `parse_error` issues, and
 * oversized payloads are rejected before `JSON.parse` runs.
 */
export function parseProjectManifestJson(
  json: string,
  options: ParseProjectManifestOptions = {},
): ValidationResult<ProjectManifest> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_MANIFEST_BYTES;
  const byteLength = new TextEncoder().encode(json).byteLength;

  if (byteLength > maxBytes) {
    return fail([
      {
        path: ROOT_PATH,
        code: 'manifest_too_large',
        message: `Project manifest is ${byteLength} bytes, which exceeds the ${maxBytes}-byte import limit.`,
      },
    ]);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail([
      {
        path: ROOT_PATH,
        code: 'parse_error',
        message: `Project manifest is not valid JSON: ${message}`,
      },
    ]);
  }

  return migrateProjectManifest(parsed);
}

// ==========================================
// PUBLIC FIELD-SCHEMA HELPERS
// ==========================================

/**
 * Validates a single runtime-configured field definition.
 *
 * @returns An empty array when the definition is valid.
 */
export function validateFieldDefinition(
  value: unknown,
  path: string = ROOT_PATH,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkFieldDefinition(value, path, issues);
  return issues;
}

/**
 * Validates a concrete value against a runtime-configured field definition.
 *
 * @param field The field definition whose `type` and (for enums) `options`
 *   drive the check.
 * @param value Untrusted attribute or default value.
 * @param path Optional diagnostic path; defaults to the manifest root.
 * @returns An empty array when the value is valid.
 */
export function validateFieldValue(
  field: FieldDefinition,
  value: unknown,
  path: string = ROOT_PATH,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateValueAgainstFieldType(
    field.type,
    value,
    path,
    issues,
    'invalid_field_value',
    `Field "${field.key}"`,
  );
  return issues;
}

// ==========================================
// SCHEMA MIGRATION
// ==========================================

type ManifestMigration = (
  manifest: Record<string, unknown>,
) => Record<string, unknown>;

function readManifestVersion(record: Record<string, unknown>): number | null {
  const value = record.schemaVersion;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Supported migration steps, keyed by the *source* schema version.
 *
 * Add an entry here whenever `CURRENT_SCHEMA_VERSION` is bumped. Each step
 * must return a new object with a strictly greater `schemaVersion`; the
 * pipeline loops until the current version is reached.
 */
const MANIFEST_MIGRATIONS: ReadonlyMap<number, ManifestMigration> = new Map<
  number,
  ManifestMigration
>([
  [0, migrateVersion0To1],
  [1, migrateVersion1To2],
]);

/**
 * v0 -> v1 migration.
 *
 * The historical v0 shape is documented by `ProjectManifestV0` and covered by
 * the Vitest suite. This step only backfills fields introduced by v1 that are
 * genuinely absent:
 *
 * - top-level `packs`
 * - card `subtypes` and `tags`
 * - deck `tags`
 *
 * `assets` was already required in v0, so it is never invented. Present-but-
 * malformed values (for example `packs: "broken"`) are preserved as-is so the
 * subsequent validator rejects the manifest. The migration never coerces a
 * malformed value (or a missing required collection) into a valid default,
 * which would hide corruption.
 *
 * @see ProjectManifestV0
 */
function migrateVersion0To1(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...manifest, schemaVersion: 1 };

  if (!Object.hasOwn(next, 'packs')) {
    next.packs = [];
  }

  if (Array.isArray(next.cards)) {
    next.cards = next.cards.map((card) => {
      if (!isRecord(card)) {
        return card;
      }

      const migratedCard: Record<string, unknown> = { ...card };
      if (!Object.hasOwn(card, 'subtypes')) {
        migratedCard.subtypes = [];
      }
      if (!Object.hasOwn(card, 'tags')) {
        migratedCard.tags = [];
      }
      return migratedCard;
    });
  }

  if (Array.isArray(next.decks)) {
    next.decks = next.decks.map((deck) => {
      if (!isRecord(deck) || Object.hasOwn(deck, 'tags')) {
        return deck;
      }
      return { ...deck, tags: [] };
    });
  }

  return next;
}

/**
 * v1 -> v2 migration.
 *
 * v2 adds optional full-card face images and the structured field type. Both
 * are additive, so existing v1 data is preserved exactly and only the schema
 * version is advanced before strict validation runs.
 */
function migrateVersion1To2(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  return { ...manifest, schemaVersion: 2 };
}

/**
 * Migrates a supported older manifest to the current schema, then validates it.
 *
 * The input is never mutated. Unknown/future versions are rejected so a newer
 * file can never silently lose data in an older build.
 *
 * @param data Untrusted value, typically the result of `JSON.parse`.
 */
export function migrateProjectManifest(
  data: unknown,
): ValidationResult<ProjectManifest> {
  if (!isRecord(data)) {
    return fail([
      {
        path: ROOT_PATH,
        code: 'expected_object',
        message: 'Project manifest must be a JSON object.',
      },
    ]);
  }

  const version = readManifestVersion(data);
  if (version === null) {
    return fail([
      {
        path: childPath(ROOT_PATH, 'schemaVersion'),
        code: 'invalid_version',
        message: 'Manifest schemaVersion must be an integer.',
      },
    ]);
  }

  if (version < MIN_SUPPORTED_SCHEMA_VERSION) {
    return fail([
      {
        path: childPath(ROOT_PATH, 'schemaVersion'),
        code: 'invalid_version',
        message: `Manifest schemaVersion ${version} is older than the minimum supported version ${MIN_SUPPORTED_SCHEMA_VERSION}.`,
      },
    ]);
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    return fail([
      {
        path: childPath(ROOT_PATH, 'schemaVersion'),
        code: 'unsupported_version',
        message: `Manifest schemaVersion ${version} is newer than the supported version ${CURRENT_SCHEMA_VERSION}.`,
      },
    ]);
  }

  if (version === CURRENT_SCHEMA_VERSION) {
    return validateProjectManifest(data);
  }

  let migrated: Record<string, unknown> = { ...data };
  let cursor = version;

  while (cursor < CURRENT_SCHEMA_VERSION) {
    const migration = MANIFEST_MIGRATIONS.get(cursor);
    if (migration === undefined) {
      return fail([
        {
          path: childPath(ROOT_PATH, 'schemaVersion'),
          code: 'missing_migration',
          message: `No migration is registered from schemaVersion ${cursor}.`,
        },
      ]);
    }

    const next = migration(migrated);
    const nextVersion = readManifestVersion(next);

    if (nextVersion === null || nextVersion <= cursor) {
      return fail([
        {
          path: childPath(ROOT_PATH, 'schemaVersion'),
          code: 'invalid_migration',
          message: `Migration from schemaVersion ${cursor} did not advance the schemaVersion.`,
        },
      ]);
    }

    migrated = next;
    cursor = nextVersion;
  }

  return validateProjectManifest(migrated);
}

// ==========================================
// ID COLLISION DETECTION
// ==========================================

export type CollidableEntityKind =
  | 'profile'
  | 'template'
  | 'card'
  | 'pack'
  | 'deck'
  | 'asset';

/**
 * Why an incoming entity was flagged:
 * - `same_entity_id`: a mutable entity would replace an existing entity.
 * - `asset_metadata_mismatch`: the content hash matches but MIME type or byte
 *   size disagrees, indicating inconsistent metadata for the same bytes.
 */
export type CollisionReason = 'same_entity_id' | 'asset_metadata_mismatch';

interface CollidableEntity {
  readonly id: string;
  readonly name: string;
}

/**
 * A conflict between an incoming manifest and an existing project.
 *
 * Collisions are reported, never resolved, so the UI can present an explicit
 * replace/merge/skip decision before applying changes atomically.
 */
export interface IdCollision {
  readonly kind: CollidableEntityKind;
  readonly id: string;
  readonly incomingName: string;
  readonly existingName: string;
  readonly reason: CollisionReason;
  readonly detail: string;
}

function collectCollisions<T extends CollidableEntity>(
  kind: CollidableEntityKind,
  incoming: readonly T[],
  existing: readonly T[],
  collisions: IdCollision[],
): void {
  const existingById = new Map<string, T>(
    existing.map((entity) => [entity.id, entity]),
  );

  for (const entity of incoming) {
    const existingEntity = existingById.get(entity.id);
    if (existingEntity === undefined) {
      continue;
    }

    collisions.push({
      kind,
      id: entity.id,
      incomingName: entity.name,
      existingName: existingEntity.name,
      reason: 'same_entity_id',
      detail: `Incoming ${kind} "${entity.name}" uses the same id as existing ${kind} "${existingEntity.name}"; choose replace, merge, or skip.`,
    });
  }
}

function collectAssetCollisions(
  incoming: readonly AssetReference[],
  existing: readonly AssetReference[],
  collisions: IdCollision[],
): void {
  const existingById = new Map<string, AssetReference>(
    existing.map((asset) => [asset.assetId, asset]),
  );

  for (const asset of incoming) {
    const existingAsset = existingById.get(asset.assetId);
    if (existingAsset === undefined) {
      continue;
    }

    // Same content hash and matching content metadata means the asset is
    // already present. Filename/path hints may differ without conflict.
    if (
      asset.mimeType === existingAsset.mimeType &&
      asset.byteSize === existingAsset.byteSize
    ) {
      continue;
    }

    const differences: string[] = [];
    if (asset.mimeType !== existingAsset.mimeType) {
      differences.push(
        `mimeType "${existingAsset.mimeType}" (existing) vs "${asset.mimeType}" (incoming)`,
      );
    }
    if (asset.byteSize !== existingAsset.byteSize) {
      differences.push(
        `byteSize ${existingAsset.byteSize} (existing) vs ${asset.byteSize} (incoming)`,
      );
    }

    collisions.push({
      kind: 'asset',
      id: asset.assetId,
      incomingName: asset.fileName,
      existingName: existingAsset.fileName,
      reason: 'asset_metadata_mismatch',
      detail: `Asset ${asset.assetId} has a matching content hash but conflicting metadata: ${differences.join('; ')}.`,
    });
  }
}

/**
 * Detects conflicts between an incoming and an existing manifest.
 *
 * - Profile: a shared profile ID is an update/replace decision.
 * - Templates/cards/packs/decks: a shared ID is an entity collision.
 * - Assets: a shared content hash is expected and ignored when MIME type and
 *   byte size agree; conflicting metadata is reported.
 *
 * Use the result to show an import preview and let the user choose an explicit
 * replace/merge/skip policy before applying changes atomically. Collisions are
 * reported, not resolved, so legitimate same-project round-trips are never
 * rejected outright.
 */
export function detectIdCollisions(
  incoming: ProjectManifest,
  existing: ProjectManifest,
): IdCollision[] {
  const collisions: IdCollision[] = [];

  if (incoming.profile.id === existing.profile.id) {
    collisions.push({
      kind: 'profile',
      id: incoming.profile.id,
      incomingName: incoming.profile.name,
      existingName: existing.profile.name,
      reason: 'same_entity_id',
      detail: `Incoming profile "${incoming.profile.name}" uses the same id as existing profile "${existing.profile.name}"; choose replace or keep-existing.`,
    });
  }

  collectCollisions('template', incoming.templates, existing.templates, collisions);
  collectCollisions('card', incoming.cards, existing.cards, collisions);
  collectCollisions('pack', incoming.packs, existing.packs, collisions);
  collectCollisions('deck', incoming.decks, existing.decks, collisions);
  collectAssetCollisions(incoming.assets, existing.assets, collisions);

  return collisions;
}

/**
 * Pre-flight analysis for importing a manifest into an existing project.
 *
 * Combines migration, full validation, and collision detection so the UI can
 * present a preview before committing state. When `existing` is omitted, only
 * migration and validation run.
 */
export interface ProjectImportAnalysis {
  readonly ok: boolean;
  readonly manifest: ProjectManifest | null;
  readonly issues: readonly ValidationIssue[];
  readonly fromSchemaVersion: number | null;
  readonly migrated: boolean;
  readonly collisions: readonly IdCollision[];
}

export function analyzeProjectImport(
  data: unknown,
  existing?: ProjectManifest,
): ProjectImportAnalysis {
  const fromSchemaVersion = isRecord(data) ? readManifestVersion(data) : null;
  const migrated =
    fromSchemaVersion !== null &&
    fromSchemaVersion >= MIN_SUPPORTED_SCHEMA_VERSION &&
    fromSchemaVersion < CURRENT_SCHEMA_VERSION;

  const result = migrateProjectManifest(data);

  if (!result.ok) {
    return {
      ok: false,
      manifest: null,
      issues: result.issues,
      fromSchemaVersion,
      migrated,
      collisions: [],
    };
  }

  return {
    ok: true,
    manifest: result.value,
    issues: [],
    fromSchemaVersion,
    migrated,
    collisions:
      existing === undefined ? [] : detectIdCollisions(result.value, existing),
  };
}
