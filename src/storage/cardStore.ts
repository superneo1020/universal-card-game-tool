import { isCardRecordShape } from '../cards/cardModel';
import type { CardRecord } from '../types/CardRecord';
import type { ValidationIssue, ValidationResult } from '../utils/validation';
import { isRecord } from '../utils/validation';
import {
  deleteStoredValue,
  readStoredValue,
  toErrorMessage,
  writeStoredValue,
} from './database';
import { cardLibraryKey } from './keys';

const CARD_LIBRARY_SCHEMA_VERSION = 1;

export type StoredCardLibraryLoadResult =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loaded'; readonly cards: readonly CardRecord[] }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'error'; readonly message: string };

function fail(
  issues: readonly ValidationIssue[],
): ValidationResult<readonly CardRecord[]> {
  return { ok: false, issues };
}

/**
 * Structural validation for the profile-scoped card library payload.
 *
 * Profile-specific field compatibility is intentionally checked in the card
 * model/UI so orphaned values remain recoverable. This guard only rejects
 * malformed persisted shapes.
 */
export function validateStoredCardLibraryPayload(
  data: unknown,
  expectedProfileId: string,
): ValidationResult<readonly CardRecord[]> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(data)) {
    return fail([
      {
        path: '$',
        code: 'expected_object',
        message: 'Stored card library must be an object.',
      },
    ]);
  }

  if (data.schemaVersion !== CARD_LIBRARY_SCHEMA_VERSION) {
    issues.push({
      path: '$.schemaVersion',
      code: 'invalid_version',
      message: `Stored card library must use schemaVersion ${CARD_LIBRARY_SCHEMA_VERSION}.`,
    });
  }

  if (data.profileId !== expectedProfileId) {
    issues.push({
      path: '$.profileId',
      code: 'unresolved_reference',
      message: 'Stored card library belongs to a different game profile.',
    });
  }

  const cards: CardRecord[] = [];
  const seenCardIds = new Set<string>();

  if (!Array.isArray(data.cards)) {
    issues.push({
      path: '$.cards',
      code: 'expected_array',
      message: 'Stored card library must contain a cards array.',
    });
  } else {
    data.cards.forEach((card, index) => {
      if (!isCardRecordShape(card)) {
        issues.push({
          path: `$.cards[${index}]`,
          code: 'invalid_literal',
          message: 'Stored card record is malformed.',
        });
        return;
      }

      if (card.profileId !== expectedProfileId) {
        issues.push({
          path: `$.cards[${index}].profileId`,
          code: 'unresolved_reference',
          message: 'Stored card belongs to a different game profile.',
        });
        return;
      }

      if (seenCardIds.has(card.id)) {
        issues.push({
          path: `$.cards[${index}].id`,
          code: 'duplicate_id',
          message: `Duplicate stored card id "${card.id}".`,
        });
        return;
      }

      seenCardIds.add(card.id);
      cards.push(card);
    });
  }

  if (issues.length > 0) {
    return fail(issues);
  }

  return { ok: true, value: cards };
}

/** Loads and structurally validates the library for one profile. */
export async function loadStoredCardLibrary(
  profileId: string,
): Promise<StoredCardLibraryLoadResult> {
  try {
    const raw = await readStoredValue(cardLibraryKey(profileId));

    if (raw === undefined) {
      return { kind: 'empty' };
    }

    const validation = validateStoredCardLibraryPayload(raw, profileId);
    if (!validation.ok) {
      return { kind: 'invalid', issues: validation.issues };
    }

    return { kind: 'loaded', cards: validation.value };
  } catch (error) {
    return { kind: 'error', message: toErrorMessage(error) };
  }
}

/** Persists one profile's card library as a single atomic write. */
export async function saveStoredCardLibrary(
  profileId: string,
  cards: readonly CardRecord[],
): Promise<void> {
  const payload = {
    schemaVersion: CARD_LIBRARY_SCHEMA_VERSION,
    profileId,
    cards: [...cards],
  };

  const validation = validateStoredCardLibraryPayload(payload, profileId);
  if (!validation.ok) {
    throw new Error(
      `Refusing to persist an invalid card library (${validation.issues.length} issue(s)).`,
    );
  }

  await writeStoredValue(cardLibraryKey(profileId), payload);
}

/** Clears one profile's card library without touching its profile record. */
export async function clearStoredCardLibrary(profileId: string): Promise<void> {
  await deleteStoredValue(cardLibraryKey(profileId));
}
