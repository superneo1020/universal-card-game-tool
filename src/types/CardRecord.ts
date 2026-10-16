// ==========================================
// LAYER 3: CARD RECORDS & INSTANCES
// ==========================================

export type FieldValue = string | number | boolean | (string | number)[];

export interface CardFace {
  faceId: string;            // e.g., "front", "back", "transformed"
  name?: string;             // Overridden name if face differs
  rulesText: string;         // Formatted text supporting keyword parsing
  flavorText?: string;
  artAssetId: string | null; // Content-hashed local IndexedDB art asset ID (never raw paths)
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