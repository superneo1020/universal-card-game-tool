// ==========================================
// LAYER 1: GAME PROFILE & SCHEMA DEFINITIONS
// ==========================================

export type PrimitiveFieldType = 'text' | 'number' | 'boolean';
export type EnumFieldType = { type: 'enum'; options: string[] };
export type ListFieldType = { type: 'list'; itemType: 'text' | 'number' };

export type FieldType = PrimitiveFieldType | EnumFieldType | ListFieldType;

export type FieldDefaultValue =
  | string
  | number
  | boolean
  | (string | number)[];

export interface FieldDefinition {
  key: string;               // e.g., "faction", "inkable", "keywords"
  label: string;             // UI Display name
  type: FieldType;           // Strict union enforcing valid types
  target: 'face' | 'root';   // Where this field resides on the card record
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