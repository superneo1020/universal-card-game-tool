import type { AssetReference } from '../types/ProjectManifest';
import { toErrorMessage } from '../utils/errors';
import type { ValidationIssue, ValidationResult } from '../utils/validation';
import {
  isAssetBinaryPayload,
  validateAssetBytes,
} from '../utils/validation';
import { readStoredValue, writeStoredValue } from './database';
import { assetStorageKey } from './keys';

/** Result of reading and verifying one stored artwork payload. */
export type StoredAssetLoadResult =
  | { readonly kind: 'missing' }
  | {
      readonly kind: 'verified';
      readonly reference: AssetReference;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Storage operations used by artwork ingestion and rendering. Tests inject
 * fakes so the verification boundary can be exercised without a browser.
 */
export interface AssetStoreDependencies {
  readonly readValue: (key: string) => Promise<unknown>;
  readonly writeValue: (key: string, value: unknown) => Promise<void>;
}

const defaultAssetStoreDependencies: AssetStoreDependencies = {
  readValue: readStoredValue,
  writeValue: writeStoredValue,
};

function toUint8Array(payload: ArrayBuffer | Uint8Array): Uint8Array {
  return payload instanceof Uint8Array
    ? new Uint8Array(payload)
    : new Uint8Array(payload);
}

/**
 * Accepts artwork bytes only after they match the asset reference's content
 * hash and declared size, then stores them under the content-addressed key.
 *
 * I/O failures throw; validation failures are returned so callers can surface
 * the specific reason instead of storing unverified bytes.
 */
export async function saveVerifiedAsset(
  reference: unknown,
  bytes: unknown,
  dependencies: AssetStoreDependencies = defaultAssetStoreDependencies,
): Promise<ValidationResult<AssetReference>> {
  const validation = await validateAssetBytes(reference, bytes);

  if (!validation.ok) {
    return validation;
  }

  if (!isAssetBinaryPayload(bytes)) {
    return {
      ok: false,
      issues: [
        {
          path: '$.bytes',
          code: 'expected_binary_data',
          message: 'Asset bytes must be an ArrayBuffer or Uint8Array.',
        },
      ],
    };
  }

  await dependencies.writeValue(
    assetStorageKey(validation.value.assetId),
    toUint8Array(bytes),
  );

  return validation;
}

/**
 * Loads stored artwork bytes and re-verifies them against the asset reference
 * before any renderer receives them. Missing or mismatched bytes are reported
 * as failures rather than falling back to unverified artwork.
 */
export async function loadVerifiedAsset(
  reference: AssetReference,
  dependencies: AssetStoreDependencies = defaultAssetStoreDependencies,
): Promise<StoredAssetLoadResult> {
  try {
    const raw = await dependencies.readValue(
      assetStorageKey(reference.assetId),
    );

    if (raw === undefined) {
      return { kind: 'missing' };
    }

    const validation = await validateAssetBytes(reference, raw);

    if (!validation.ok) {
      return { kind: 'invalid', issues: validation.issues };
    }

    if (!isAssetBinaryPayload(raw)) {
      return {
        kind: 'invalid',
        issues: [
          {
            path: '$.bytes',
            code: 'expected_binary_data',
            message: 'Stored asset bytes are not binary data.',
          },
        ],
      };
    }

    return {
      kind: 'verified',
      reference: validation.value,
      bytes: toUint8Array(raw),
    };
  } catch (error) {
    return { kind: 'error', message: toErrorMessage(error) };
  }
}
