import { useId, useState } from 'react';

import type { ProjectImportPolicy } from '../hooks/useProject';
import {
  analyzeProjectFile,
  createProjectArchive,
  createProjectJson,
  type ProjectFilePreview,
} from '../project/projectFiles';
import type { ProjectManifest } from '../types/ProjectManifest';
import type { ValidationIssue } from '../utils/validation';

interface ProjectFilesPanelProps {
  readonly project: ProjectManifest | null;
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly unsavedProfileChanges: boolean;
  readonly onImport: (
    manifest: ProjectManifest,
    policy: ProjectImportPolicy,
    assetBytes: ReadonlyMap<string, Uint8Array>,
  ) => Promise<boolean>;
}

function summarizeIssues(issues: readonly ValidationIssue[]): string {
  const preview = issues
    .slice(0, 4)
    .map((issue) => issue.message)
    .join(' ');

  return issues.length > 4
    ? `${preview} (+${issues.length - 4} more)`
    : preview;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJson(project: ProjectManifest) {
  const fileName = `${project.projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'card-studio-project'}.json`;
  downloadBlob(
    new Blob([createProjectJson(project)], {
      type: 'application/json',
    }),
    fileName,
  );
}

/**
 * Project file operations: metadata-only JSON export, complete ZIP backup,
 * and a strict import preview with explicit replace/merge choices.
 */
export function ProjectFilesPanel({
  project,
  saving,
  saveErrorMessage,
  saveIssues,
  unsavedProfileChanges,
  onImport,
}: ProjectFilesPanelProps) {
  const fileInputId = useId();
  const [exporting, setExporting] = useState<'json' | 'zip' | null>(null);
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [fileIssues, setFileIssues] = useState<readonly ValidationIssue[]>([]);
  const [fileErrorMessage, setFileErrorMessage] = useState<string | null>(
    null,
  );

  async function handleFile(file: File | undefined) {
    if (file === undefined) {
      return;
    }

    setPreview(null);
    setFileIssues([]);
    setFileErrorMessage(null);

    const analysis = await analyzeProjectFile(file, project ?? undefined);

    if (!analysis.ok) {
      setFileIssues(analysis.issues);
      return;
    }

    setPreview(analysis.preview);
  }

  async function exportArchive() {
    if (project === null) {
      return;
    }

    setExporting('zip');
    setFileIssues([]);
    setFileErrorMessage(null);

    try {
      const result = await createProjectArchive(project);

      if (!result.ok) {
        setFileIssues(result.issues);
        return;
      }

      downloadBlob(result.blob, result.fileName);
    } catch (error) {
      setFileErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExporting(null);
    }
  }

  async function apply(policy: ProjectImportPolicy) {
    if (preview === null) {
      return;
    }

    const imported = await onImport(
      preview.manifest,
      policy,
      preview.assetBytes,
    );

    if (imported) {
      setPreview(null);
      setFileIssues([]);
      setFileErrorMessage(null);
    }
  }

  const canMerge =
    project !== null &&
    preview !== null &&
    preview.manifest.profile.id === project.profile.id &&
    preview.assetIssues.length === 0;
  const canApply = preview !== null && preview.assetIssues.length === 0;

  return (
    <section className="project-files" aria-labelledby="project-files-title">
      <div className="profile-editor__section-header">
        <div>
          <p className="eyebrow">Project files</p>
          <h4 id="project-files-title">Import and export</h4>
          <p>
            JSON exports contain metadata only. ZIP backups include the manifest
            and every content-addressed artwork payload.
          </p>
        </div>
      </div>

      {unsavedProfileChanges ? (
        <p className="project-files__warning" role="status">
          You have unsaved profile edits. Importing a project replaces the saved
          project and discards those edits.
        </p>
      ) : null}

      <div className="project-files__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={project === null || saving || exporting !== null}
          onClick={() => {
            if (project !== null) {
              downloadJson(project);
            }
          }}
        >
          Export JSON
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={project === null || saving || exporting !== null}
          onClick={() => {
            void exportArchive();
          }}
        >
          {exporting === 'zip' ? 'Building ZIP…' : 'Export ZIP backup'}
        </button>

        <label className="button button--primary" htmlFor={fileInputId}>
          Choose import file
        </label>
        <input
          id={fileInputId}
          className="sr-only"
          type="file"
          accept=".json,.zip,application/json,application/zip"
          disabled={saving}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void handleFile(file);
          }}
        />
      </div>

      {fileErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">{fileErrorMessage}</p>
        </div>
      )}

      {fileIssues.length === 0 ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">
            This file could not be imported
          </p>
          <p>{summarizeIssues(fileIssues)}</p>
        </div>
      )}

      {saveErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">{saveErrorMessage}</p>
          {saveIssues.length === 0 ? null : (
            <p>{summarizeIssues(saveIssues)}</p>
          )}
        </div>
      )}

      {preview === null ? null : (
        <div className="project-files__preview">
          <div className="project-files__preview-heading">
            <div>
              <p className="eyebrow">Import preview</p>
              <h4>{preview.fileName}</h4>
            </div>
            <span className="chip chip--muted">
              {preview.kind === 'zip' ? 'Complete backup' : 'Metadata only'}
            </span>
          </div>

          <dl className="collection-meta">
            <div>
              <dt>Profile</dt>
              <dd>{preview.manifest.profile.name}</dd>
            </div>
            <div>
              <dt>Templates</dt>
              <dd>{preview.manifest.templates.length}</dd>
            </div>
            <div>
              <dt>Cards</dt>
              <dd>{preview.manifest.cards.length}</dd>
            </div>
            <div>
              <dt>Packs</dt>
              <dd>{preview.manifest.packs.length}</dd>
            </div>
            <div>
              <dt>Decks</dt>
              <dd>{preview.manifest.decks.length}</dd>
            </div>
            <div>
              <dt>Assets</dt>
              <dd>{preview.manifest.assets.length}</dd>
            </div>
          </dl>

          <p className="form-hint">
            Schema {preview.fromSchemaVersion ?? preview.manifest.schemaVersion}
            {preview.migrated ? ' · migrated to the current version' : ''}
          </p>

          {preview.kind === 'json' ? (
            <p className="project-files__warning" role="status">
              JSON imports do not contain image bytes. Existing local artwork
              remains usable; newly referenced images will show as missing
              until relinked.
            </p>
          ) : null}

          {preview.assetIssues.length === 0 ? null : (
            <div
              className="validation-banner validation-banner--error"
              role="alert"
            >
              <p className="validation-banner__title">
                Archive artwork failed verification
              </p>
              <p>{summarizeIssues(preview.assetIssues)}</p>
            </div>
          )}

          {preview.collisions.length === 0 ? null : (
            <div className="project-files__collisions">
              <p className="project-files__collision-title">
                {preview.collisions.length} ID collision
                {preview.collisions.length === 1 ? '' : 's'}
              </p>
              <ul>
                {preview.collisions.map((collision) => (
                  <li key={`${collision.kind}-${collision.id}-${collision.reason}`}>
                    {collision.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="project-files__preview-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!canApply || saving}
              onClick={() => {
                void apply('replace');
              }}
            >
              Replace project
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={!canMerge || saving}
              onClick={() => {
                void apply('merge');
              }}
            >
              Merge incoming
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={saving}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
          <p className="form-hint">
            Replace uses the imported project as-is. Merge keeps existing
            entities and lets incoming entities win on matching IDs. Merge is
            only available when both projects share the same profile id.
          </p>
        </div>
      )}
    </section>
  );
}
