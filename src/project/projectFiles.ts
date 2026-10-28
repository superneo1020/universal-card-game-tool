import { unzipSync, zipSync } from 'fflate';

import { loadVerifiedAsset } from '../storage/assetStore';
import type { AssetReference, ProjectManifest } from '../types/ProjectManifest';
import type {
  IdCollision,
  ValidationIssue,
} from '../utils/validation';
import {
  DEFAULT_MAX_MANIFEST_BYTES,
  analyzeProjectImport,
  validateAssetBytes,
} from '../utils/validation';

export const DEFAULT_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
export const DEFAULT_MAX_ARCHIVE_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

export interface ProjectFilePreview {
  readonly fileName: string;
  readonly kind: 'json' | 'zip';
  readonly manifest: ProjectManifest;
  readonly migrated: boolean;
  readonly fromSchemaVersion: number | null;
  readonly collisions: readonly IdCollision[];
  readonly assetBytes: ReadonlyMap<string, Uint8Array>;
  readonly assetIssues: readonly ValidationIssue[];
}

export type ProjectFileAnalysis =
  | { readonly ok: true; readonly preview: ProjectFilePreview }
  | ProjectFileFailure;

interface ProjectFileFailure {
  readonly ok: false;
  readonly issues: readonly ValidationIssue[];
}

function fail(
  code: ValidationIssue['code'],
  message: string,
  path = '$',
): ProjectFileFailure {
  return { ok: false, issues: [{ path, code, message }] };
}

function assetIssuePath(index: number, suffix = ''): string {
  return `$.assets[${index}]${suffix}`;
}

type ManifestParseResult =
  | ReturnType<typeof analyzeProjectImport>
  | ProjectFileFailure;

function parseManifestText(
  text: string,
  existing: ProjectManifest | undefined,
): ManifestParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      'parse_error',
      `Project manifest is not valid JSON: ${message}`,
    );
  }

  return analyzeProjectImport(parsed, existing);
}

function projectJsonFileName(project: ProjectManifest): string {
  const base = project.projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${base.length === 0 ? 'card-studio-project' : base}.json`;
}

function projectArchiveFileName(project: ProjectManifest): string {
  return projectJsonFileName(project).replace(/\.json$/, '-backup.zip');
}

/** Serializes the metadata-only project manifest. */
export function createProjectJson(project: ProjectManifest): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Builds a complete portable backup: metadata plus verified asset bytes.
 * Any missing or mismatched asset aborts the archive instead of producing a
 * partial backup that looks complete.
 */
export async function createProjectArchive(
  project: ProjectManifest,
): Promise<
  | {
      readonly ok: true;
      readonly blob: Blob;
      readonly fileName: string;
    }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }
> {
  const files: Record<string, Uint8Array> = {
    'project.json': new TextEncoder().encode(createProjectJson(project)),
  };
  const issues: ValidationIssue[] = [];

  for (const [index, asset] of project.assets.entries()) {
    const loaded = await loadVerifiedAsset(asset);

    switch (loaded.kind) {
      case 'verified':
        files[`assets/${asset.assetId}`] = new Uint8Array(loaded.bytes);
        break;

      case 'missing':
        issues.push({
          path: assetIssuePath(index, '.assetId'),
          code: 'unresolved_reference',
          message: `Asset "${asset.fileName}" is referenced but its bytes are missing from this browser.`,
        });
        break;

      case 'invalid':
        issues.push(
          ...loaded.issues.map((issue) => ({
            ...issue,
            path: assetIssuePath(
              index,
              issue.path === '$' ? '' : issue.path.replace(/^\$/, ''),
            ),
          })),
        );
        break;

      case 'error':
        issues.push({
          path: assetIssuePath(index),
          code: 'invalid_literal',
          message: `Asset "${asset.fileName}" could not be read: ${loaded.message}`,
        });
        break;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const zipped = zipSync(files, { level: 6 });

  return {
    ok: true,
    blob: new Blob([new Uint8Array(zipped)], {
      type: 'application/zip',
    }),
    fileName: projectArchiveFileName(project),
  };
}

async function analyzeArchive(
  file: File,
  existing: ProjectManifest | undefined,
): Promise<ProjectFileAnalysis> {
  if (file.size > DEFAULT_MAX_ARCHIVE_BYTES) {
    return fail(
      'manifest_too_large',
      `Archive is ${file.size} bytes, which exceeds the ${DEFAULT_MAX_ARCHIVE_BYTES}-byte import limit.`,
    );
  }

  let entries: Record<string, Uint8Array>;

  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('parse_error', `Project archive is not a valid ZIP: ${message}`);
  }

  const totalBytes = Object.values(entries).reduce(
    (total, entry) => total + entry.byteLength,
    0,
  );

  if (totalBytes > DEFAULT_MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    return fail(
      'manifest_too_large',
      `Archive expands to ${totalBytes} bytes, which exceeds the ${DEFAULT_MAX_ARCHIVE_UNCOMPRESSED_BYTES}-byte uncompressed limit.`,
    );
  }

  const manifestBytes = entries['project.json'];

  if (manifestBytes === undefined) {
    return fail(
      'missing_property',
      'Archive does not contain project.json.',
      '$.project.json',
    );
  }

  let manifestText: string;

  try {
    manifestText = new TextDecoder('utf-8', { fatal: true }).decode(
      manifestBytes,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('parse_error', `project.json is not valid UTF-8: ${message}`);
  }

  const analysis = parseManifestText(manifestText, existing);

  if (!analysis.ok || !('manifest' in analysis) || analysis.manifest === null) {
    return { ok: false, issues: analysis.issues };
  }

  const manifest = analysis.manifest;
  const assetBytes = new Map<string, Uint8Array>();
  const assetIssues: ValidationIssue[] = [];

  for (const [index, asset] of manifest.assets.entries()) {
    const bytes = entries[`assets/${asset.assetId}`];

    if (bytes === undefined) {
      assetIssues.push({
        path: assetIssuePath(index, '.assetId'),
        code: 'unresolved_reference',
        message: `Archive is missing bytes for asset "${asset.fileName}".`,
      });
      continue;
    }

    const verified = await validateAssetBytes(asset, bytes, {
      path: assetIssuePath(index),
    });

    if (!verified.ok) {
      assetIssues.push(...verified.issues);
      continue;
    }

    assetBytes.set(asset.assetId, bytes);
  }

  return {
    ok: true,
    preview: {
      fileName: file.name,
      kind: 'zip',
      manifest: analysis.manifest,
      migrated: analysis.migrated,
      fromSchemaVersion: analysis.fromSchemaVersion,
      collisions: analysis.collisions,
      assetBytes,
      assetIssues,
    },
  };
}

async function analyzeJson(
  file: File,
  existing: ProjectManifest | undefined,
): Promise<ProjectFileAnalysis> {
  if (file.size > DEFAULT_MAX_MANIFEST_BYTES) {
    return fail(
      'manifest_too_large',
      `Project manifest is ${file.size} bytes, which exceeds the ${DEFAULT_MAX_MANIFEST_BYTES}-byte import limit.`,
    );
  }

  const analysis = parseManifestText(await file.text(), existing);

  if (!analysis.ok || !('manifest' in analysis) || analysis.manifest === null) {
    return { ok: false, issues: analysis.issues };
  }

  return {
    ok: true,
    preview: {
      fileName: file.name,
      kind: 'json',
      manifest: analysis.manifest,
      migrated: analysis.migrated,
      fromSchemaVersion: analysis.fromSchemaVersion,
      collisions: analysis.collisions,
      assetBytes: new Map<string, Uint8Array>(),
      assetIssues: [],
    },
  };
}

/**
 * Parses and validates a JSON manifest or ZIP backup against the existing
 * project. ZIP backups also verify every referenced asset's bytes.
 */
export async function analyzeProjectFile(
  file: File,
  existing?: ProjectManifest,
): Promise<ProjectFileAnalysis> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.json') || file.type === 'application/json') {
    return analyzeJson(file, existing);
  }

  if (lowerName.endsWith('.zip') || file.type === 'application/zip') {
    return analyzeArchive(file, existing);
  }

  return fail(
    'invalid_literal',
    'Choose a .json manifest or a .zip project backup.',
  );
}

/** Finds a referenced asset in a verified byte map. */
export function assetBytesFor(
  preview: ProjectFilePreview,
  asset: AssetReference,
): Uint8Array | undefined {
  return preview.assetBytes.get(asset.assetId);
}
