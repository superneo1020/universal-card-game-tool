// ==========================================
// VERSIONED PROJECT MANIFEST (MASTER COPY)
// ==========================================

import type { CardTemplate } from './Card';
import type { CardRecord } from './CardRecord';
import type { CardPack, Deck } from './Collection';
import type { GameProfile } from './Game';

/**
 * Current on-disk / import schema version.
 *
 * Bump this whenever the persisted shape changes and add a corresponding
 * migration in `src/utils/validation.ts`.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Oldest schema version the migration pipeline can upgrade from.
 */
export const MIN_SUPPORTED_SCHEMA_VERSION = 0;

/**
 * Metadata-only reference to an image stored in IndexedDB.
 *
 * Identity is always the content hash (`assetId`). `fileName` and
 * `relativePathHint` exist purely as optional relinking hints for a human
 * choosing files again; they must never be treated as identity.
 */
export interface AssetReference {
  assetId: string;
  fileName: string;
  relativePathHint?: string;
  mimeType: string;
  byteSize: number;
}

/**
 * Complete, versioned master-copy payload for a project.
 *
 * A JSON export of this shape is metadata-only: image bytes live in the
 * matching ZIP asset archive (or directly in IndexedDB while editing).
 * Untrusted JSON must be passed through `migrateProjectManifest` /
 * `isProjectManifest` before it is used to update application state.
 */
export interface ProjectManifest {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  projectId: string;
  projectName: string;
  createdAt?: string;
  updatedAt?: string;
  profile: GameProfile;
  templates: CardTemplate[];
  cards: CardRecord[];
  packs: CardPack[];
  decks: Deck[];
  assets: AssetReference[];
}

/**
 * Card record shape accepted by the historical v0 schema.
 *
 * v0 predates the additive `subtypes` and `tags` fields; they are optional
 * here so the migration fixture and migration step stay explicitly typed.
 */
export type LegacyCardRecordV0 = Omit<CardRecord, 'subtypes' | 'tags'> & {
  subtypes?: CardRecord['subtypes'];
  tags?: CardRecord['tags'];
};

/** Deck shape accepted by the historical v0 schema (no `tags`). */
export type LegacyDeckV0 = Omit<Deck, 'tags'> & {
  tags?: Deck['tags'];
};

/**
 * Historical v0 master-copy shape, documented and covered by the migration
 * tests.
 *
 * v0 already had content-addressed `assets`, but had no `packs` collection and
 * omitted additive card `subtypes`/`tags` and deck `tags`. The migration
 * pipeline only backfills fields introduced by v1 when they are genuinely
 * absent; present-but-malformed values (and a missing required `assets`
 * collection) are left untouched so validation rejects the payload instead of
 * silently repairing it.
 */
export interface ProjectManifestV0 {
  schemaVersion: 0;
  projectId: string;
  projectName: string;
  createdAt?: string;
  updatedAt?: string;
  profile: GameProfile;
  templates: CardTemplate[];
  cards: LegacyCardRecordV0[];
  decks: LegacyDeckV0[];
  assets: AssetReference[];
}
