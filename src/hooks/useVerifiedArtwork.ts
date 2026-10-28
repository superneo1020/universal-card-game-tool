import { useEffect, useRef, useState } from 'react';

import { loadVerifiedAsset } from '../storage/assetStore';
import type { AssetReference } from '../types/ProjectManifest';
import { toErrorMessage } from '../utils/errors';
import type { ValidationIssue } from '../utils/validation';

export type VerifiedArtworkState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' }
  | { readonly status: 'verified'; readonly objectUrl: string }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly status: 'error'; readonly message: string };

type ArtworkLoadResult =
  | { readonly status: 'verified'; readonly objectUrl: string }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly status: 'error'; readonly message: string };

interface ArtworkStateRecord {
  readonly assetId: string;
  readonly result: ArtworkLoadResult;
}

/**
 * Loads and verifies stored artwork bytes before creating an object URL for
 * rendering. Mismatched or missing bytes never fall through to an unverified
 * image.
 */
export function useVerifiedArtwork(
  reference: AssetReference | null,
): VerifiedArtworkState {
  const [stateRecord, setStateRecord] =
    useState<ArtworkStateRecord | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const assetId = reference?.assetId ?? null;

  useEffect(() => {
    if (reference === null) {
      return;
    }

    let cancelled = false;

    void loadVerifiedAsset(reference).then((result) => {
      if (cancelled) {
        return;
      }

      switch (result.kind) {
        case 'missing':
          setStateRecord({
            assetId: reference.assetId,
            result: { status: 'missing' },
          });
          return;

        case 'invalid':
          setStateRecord({
            assetId: reference.assetId,
            result: { status: 'invalid', issues: result.issues },
          });
          return;

        case 'error':
          setStateRecord({
            assetId: reference.assetId,
            result: { status: 'error', message: result.message },
          });
          return;

        case 'verified': {
          try {
            const objectUrl = URL.createObjectURL(
              new Blob([new Uint8Array(result.bytes)], {
                type: result.reference.mimeType,
              }),
            );

            if (objectUrlRef.current !== null) {
              URL.revokeObjectURL(objectUrlRef.current);
            }

            objectUrlRef.current = objectUrl;
            setStateRecord({
              assetId: reference.assetId,
              result: { status: 'verified', objectUrl },
            });
          } catch (error) {
            setStateRecord({
              assetId: reference.assetId,
              result: {
                status: 'error',
                message: `Could not create an artwork URL: ${toErrorMessage(
                  error,
                )}`,
              },
            });
          }
          return;
        }
      }
    });

    return () => {
      cancelled = true;

      if (objectUrlRef.current !== null) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      // Do not retain a verified record whose object URL was just revoked.
      setStateRecord(null);
    };
  }, [reference]);

  if (reference === null || assetId === null) {
    return { status: 'empty' };
  }

  if (stateRecord === null || stateRecord.assetId !== assetId) {
    return { status: 'loading' };
  }

  return stateRecord.result;
}
