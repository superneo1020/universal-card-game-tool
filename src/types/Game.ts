// ==========================================
// LAYER 1: GAME PROFILE & SCHEMA DEFINITIONS
// ==========================================

/**
 * Every field-type variant is uniformly discriminated by a `type` key.
 *
 * Keeping even the primitive variants as objects (rather than bare string
 * literals) gives runtime validators and renderers a single, exhaustive
 * `switch (fieldType.type)` shape to work with.
 */
/** Maximum structured nesting depth, including the root structured field. */
export const MAX_STRUCTURED_DEPTH = 3;

export type TextFieldType = { type: 'text' };
export type NumberFieldType = { type: 'number' };
export type BooleanFieldType = { type: 'boolean' };
export type EnumFieldType = { type: 'enum'; options: string[] };
export type ListFieldType = { type: 'list'; itemType: 'text' | 'number' };

/** Scalar types supported inside a structured entry. */
export type ScalarFieldType =
  | TextFieldType
  | NumberFieldType
  | BooleanFieldType
  | EnumFieldType
  | ListFieldType;

export interface StructuredChildDefinition {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  defaultValue?: FieldDefaultValue;
}

/**
 * Repeating record composed from typed children. Children may themselves be
 * structured up to {@link MAX_STRUCTURED_DEPTH}, which allows tables such as a
 * creature level containing a nested colored-cost list.
 */
export interface StructuredFieldType {
  type: 'structured';
  children: StructuredChildDefinition[];
}

export type FieldType = ScalarFieldType | StructuredFieldType;

export type ScalarFieldDefaultValue =
  | string
  | number
  | boolean
  | (string | number)[];

export type FieldDefaultValue =
  | ScalarFieldDefaultValue
  | StructuredFieldEntry[];

export interface StructuredFieldEntry {
  entryId: string;
  values: Record<string, FieldValue>;
}

export type ScalarFieldValue =
  | string
  | number
  | boolean
  | (string | number)[];

export type FieldValue = ScalarFieldValue | StructuredFieldEntry[];

export interface FieldDefinition {
  key: string;               // e.g., "faction", "inkable", "keywords"
  label: string;             // UI Display name
  type: FieldType;           // Strict union enforcing valid types
  target: 'face' | 'root';   // Where this field resides on the card record
  cardTypes?: string[];      // Optional applicability; empty/absent means all types
  required?: boolean;
  defaultValue?: FieldDefaultValue;
}

export interface DeckRules {
  minSize: number;
  maxSize: number;
  maxCopiesPerCard: number;
}

export interface GameProfile {
  id: string;                // Stable UUID
  name: string;              // e.g., "Fantasy TCG v1"
  cardTypes: string[];       // e.g., ["Creature", "Spell", "Artifact"]
  subtypes: string[];        // e.g., ["Dragon", "Goblin", "Wizard"]
  keywords: string[];        // Global keyword library for rules parsing
  fieldDefinitions: FieldDefinition[];
  deckRules: DeckRules;
}