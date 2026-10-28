import { describe, expect, it } from 'vitest';

import type { AssetReference } from '../types/ProjectManifest';
import type { AssetStoreDependencies } from './assetStore';
import { loadVerifiedAsset, saveVerifiedAsset } from './assetStore';
import { assetStorageKey } from './keys';

const HELLO_HASH =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const helloBytes = new TextEncoder().encode('hello');

function makeReference(
  overrides: Partial<AssetReference> = {},
): AssetReference {
  return {
    assetId: HELLO_HASH,
    fileName: 'hello.txt',
    mimeType: 'text/plain',
    byteSize: helloBytes.byteLength,
    ...overrides,
  };
}

interface AssetStoreHarness {
  readonly dependencies: AssetStoreDependencies;
  readonly writes: Array<{ readonly key: string; readonly value: unknown }>;
  readonly values: Map<string, unknown>;
}

function makeDependencies(
  initial: Readonly<Record<string, unknown>> = {},
): AssetStoreHarness {
  const values = new Map<string, unknown>(Object.entries(initial));
  const writes: Array<{ readonly key: string; readonly value: unknown }> = [];

  const dependencies: AssetStoreDependencies = {
    readValue: async (key) => values.get(key),
    writeValue: async (key, value) => {
      values.set(key, value);
      writes.push({ key, value });
    },
  };

  return { dependencies, writes, values };
}

describe('asset store', () => {
  it('stores bytes only after they pass content verification', async () => {
    const { dependencies, writes } = makeDependencies();

    const result = await saveVerifiedAsset(
      makeReference(),
      helloBytes,
      dependencies,
    );

    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe(assetStorageKey(HELLO_HASH));
    expect(writes[0]?.value).toEqual(helloBytes);
  });

  it('refuses to store bytes that do not match the reference', async () => {
    const { dependencies, writes } = makeDependencies();

    const result = await saveVerifiedAsset(
      makeReference({ assetId: '0'.repeat(64) }),
      helloBytes,
      dependencies,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'content_hash_mismatch',
            path: '$.assetId',
          }),
        ]),
      );
    }
    expect(writes).toEqual([]);
  });

  it('refuses to store non-binary payloads', async () => {
    const { dependencies, writes } = makeDependencies();

    const result = await saveVerifiedAsset(
      makeReference(),
      'hello',
      dependencies,
    );

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it('reports missing stored bytes', async () => {
    const { dependencies } = makeDependencies();

    await expect(
      loadVerifiedAsset(makeReference(), dependencies),
    ).resolves.toEqual({ kind: 'missing' });
  });

  it('returns verified bytes for rendering', async () => {
    const { dependencies } = makeDependencies({
      [assetStorageKey(HELLO_HASH)]: helloBytes,
    });

    const result = await loadVerifiedAsset(makeReference(), dependencies);

    expect(result.kind).toBe('verified');
    if (result.kind === 'verified') {
      expect(result.reference.assetId).toBe(HELLO_HASH);
      expect(result.bytes).toEqual(helloBytes);
    }
  });

  it('rejects tampered stored bytes instead of rendering them', async () => {
    const { dependencies } = makeDependencies({
      [assetStorageKey(HELLO_HASH)]: new TextEncoder().encode('tampered'),
    });

    const result = await loadVerifiedAsset(makeReference(), dependencies);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'content_hash_mismatch' }),
          expect.objectContaining({ code: 'byte_size_mismatch' }),
        ]),
      );
    }
  });

  it('rejects stored bytes with the wrong declared size', async () => {
    const { dependencies } = makeDependencies({
      [assetStorageKey(HELLO_HASH)]: helloBytes,
    });

    const result = await loadVerifiedAsset(
      makeReference({ byteSize: 6 }),
      dependencies,
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'byte_size_mismatch' }),
        ]),
      );
    }
  });
});
