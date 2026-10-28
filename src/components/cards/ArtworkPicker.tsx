import { useId, useRef, useState } from 'react';

import type { ArtworkImportResult } from '../../hooks/useProject';
import { useVerifiedArtwork } from '../../hooks/useVerifiedArtwork';
import type { AssetReference } from '../../types/ProjectManifest';
import { toErrorMessage } from '../../utils/errors';
import { VerifiedArtworkImage } from './VerifiedArtworkImage';

interface ArtworkPickerProps {
  readonly assets: readonly AssetReference[];
  readonly selectedAssetId: string | null;
  readonly disabled: boolean;
  readonly label?: string;
  readonly emptyLabel?: string;
  readonly emptyOptionLabel?: string;
  readonly hint?: string;
  readonly altLabel?: string;
  readonly onSelect: (assetId: string | null) => void;
  readonly onImport: (files: readonly File[]) => Promise<ArtworkImportResult>;
}

interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile: () => Promise<File>;
}

interface DirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  values: () => AsyncIterableIterator<FileSystemHandleLike>;
}

type FileSystemHandleLike = FileHandleLike | DirectoryHandleLike;

type DirectoryPicker = () => Promise<DirectoryHandleLike>;

function formatBytes(byteSize: number): string {
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

async function collectHandleFiles(
  handle: FileSystemHandleLike,
): Promise<File[]> {
  if (handle.kind === 'file') {
    return [await handle.getFile()];
  }

  const files: File[] = [];

  for await (const child of handle.values()) {
    files.push(...(await collectHandleFiles(child)));
  }

  return files;
}

function readEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries((entries) => resolve(entries), reject);
  });
}

async function collectDroppedEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return [
      await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      }),
    ];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  let batch: FileSystemEntry[];

  do {
    batch = await readEntries(reader);
    for (const child of batch) {
      files.push(...(await collectDroppedEntry(child)));
    }
  } while (batch.length > 0);

  return files;
}

/**
 * Verified artwork picker. Imported files are hashed and stored before they
 * become selectable; drag/drop, directory picking, and multi-file selection
 * are progressive enhancements over the basic file input.
 */
export function ArtworkPicker({
  assets,
  selectedAssetId,
  disabled,
  label = 'Artwork',
  emptyLabel = 'No artwork selected.',
  emptyOptionLabel = 'No artwork',
  hint = 'Images are hashed with SHA-256 before storage. Drop files or folders here, or choose images explicitly.',
  altLabel = 'Selected artwork',
  onSelect,
  onImport,
}: ArtworkPickerProps) {
  const selectId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const selectedAsset =
    selectedAssetId === null
      ? null
      : (assets.find((asset) => asset.assetId === selectedAssetId) ?? null);
  const artwork = useVerifiedArtwork(selectedAsset);
  const canPickDirectory =
    typeof window !== 'undefined' &&
    ('showDirectoryPicker' in window ||
      'webkitdirectory' in document.createElement('input'));

  async function importFiles(files: readonly File[]) {
    if (files.length === 0) {
      return;
    }

    setImporting(true);
    setErrors([]);

    try {
      const result = await onImport(files);
      setErrors(result.errors);

      if (result.imported.length > 0) {
        onSelect(result.imported[0]?.assetId ?? null);
      }
    } catch (error) {
      setErrors([toErrorMessage(error)]);
    } finally {
      setImporting(false);
    }
  }

  async function pickDirectory() {
    const picker = (
      window as unknown as { showDirectoryPicker?: DirectoryPicker }
    ).showDirectoryPicker;

    if (picker === undefined) {
      folderInputRef.current?.click();
      return;
    }

    try {
      const handle = await picker();
      await importFiles(await collectHandleFiles(handle));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setErrors([toErrorMessage(error)]);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);

    const items = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);

    if (items.length > 0) {
      const nested = await Promise.all(items.map(collectDroppedEntry));
      await importFiles(nested.flat());
      return;
    }

    await importFiles(Array.from(event.dataTransfer.files));
  }

  function renderPreview() {
    if (selectedAssetId === null) {
      return (
        <p className="artwork-picker__placeholder">{emptyLabel}</p>
      );
    }

    if (selectedAsset === null) {
      return (
        <p className="artwork-picker__placeholder">
          Image imported; waiting for the project to update…
        </p>
      );
    }

    if (artwork.status === 'verified') {
      return (
        <VerifiedArtworkImage
          key={artwork.objectUrl}
          objectUrl={artwork.objectUrl}
          alt={`${altLabel} ${selectedAsset.fileName}`}
        />
      );
    }

    if (artwork.status === 'invalid') {
      return (
        <p className="artwork-picker__placeholder artwork-picker__placeholder--error">
          {artwork.issues[0]?.message ?? 'Stored artwork failed verification.'}
        </p>
      );
    }

    if (artwork.status === 'missing') {
      return (
        <p className="artwork-picker__placeholder">
          The image bytes are missing from this browser.
        </p>
      );
    }

    if (artwork.status === 'error') {
      return (
        <p className="artwork-picker__placeholder artwork-picker__placeholder--error">
          {artwork.message}
        </p>
      );
    }

    return (
      <p className="artwork-picker__placeholder" role="status">
        Verifying artwork…
      </p>
    );
  }

  return (
    <div
      className={`artwork-picker${dragActive ? ' artwork-picker--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        void handleDrop(event);
      }}
    >
      <div className="artwork-picker__preview">{renderPreview()}</div>

      <div className="artwork-picker__controls">
        <div className="form-field">
          <label htmlFor={selectId}>{label}</label>
          <select
            id={selectId}
            className="select-input"
            value={selectedAssetId ?? ''}
            disabled={disabled || importing}
            onChange={(event) =>
              onSelect(
                event.target.value === '' ? null : event.target.value,
              )
            }
          >
            <option value="">{emptyOptionLabel}</option>
            {assets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {asset.fileName} ({formatBytes(asset.byteSize)})
              </option>
            ))}
          </select>
        </div>

        <div className="inline-form">
          <button
            type="button"
            className="button button--secondary"
            disabled={disabled || importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'Importing…' : 'Add images'}
          </button>
          {canPickDirectory ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={disabled || importing}
              onClick={() => {
                void pickDirectory();
              }}
            >
              Add folder
            </button>
          ) : null}
          {selectedAssetId === null ? null : (
            <button
              type="button"
              className="button button--ghost"
              disabled={disabled || importing}
              onClick={() => onSelect(null)}
            >
              Remove
            </button>
          )}
        </div>

        <p className="form-hint">{hint}</p>

        {errors.length === 0 ? null : (
          <div
            className="validation-banner validation-banner--error"
            role="alert"
          >
            <p className="validation-banner__title">
              Some artwork could not be imported
            </p>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void importFiles(files);
        }}
      />
      <input
        ref={(input) => {
          folderInputRef.current = input;
          if (input !== null) {
            input.setAttribute('webkitdirectory', '');
            input.setAttribute('directory', '');
          }
        }}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void importFiles(files);
        }}
      />
    </div>
  );
}
