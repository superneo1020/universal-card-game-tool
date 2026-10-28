// ==========================================
// LAYER 3: CARD RECORDS & INSTANCES
// ==========================================

import type { FieldValue } from './Game';

export type { FieldValue, ScalarFieldValue } from './Game';

export interface CardFace {
  faceId: string;            // e.g., "front", "back", "transformed"
  name?: string;             // Overridden name if face differs
  cardType?: string;         // Overrides the card-level type for this face
  subtypes?: string[];       // Overrides card-level subtypes for this face
  rulesText: string;         // Formatted text supporting keyword parsing
  flavorText?: string;
  artAssetId: string | null; // Content-hashed art-box image used inside the template
  fullCardAssetId?: string | null; // Content-hashed scan/export of the finished card
  faceAttributes: Record<string, FieldValue>; // Dynamic values for fields targeted to 'face'
}

export interface CardRecord {
  id: string;                // Stable UUID
  profileId: string;         // Links to GameProfile
  templateId: string;        // Links to CardTemplate
  name: string;              // Primary display name
  cardType: string;          // Must match GameProfile.cardTypes
  subtypes: string[];        // Validated against GameProfile.subtypes
  faces: CardFace[];         // Supports single, double-faced, or multi-face cards
  rootAttributes: Record<string, FieldValue>; // Dynamic values for fields targeted to 'root'
  tags: string[];            // Flat tagging system for v1 organization & filtering
}