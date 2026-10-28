import { useId } from 'react';

import { createUniqueId } from '../../utils/ids';
import type {
  StructuredChildDefinition,
  StructuredFieldEntry,
  StructuredFieldType,
} from '../../types/Game';
import { MAX_STRUCTURED_DEPTH } from '../../types/Game';
import type { FieldValue } from '../../types/CardRecord';
import { ValueListEditor } from '../ValueListEditor';

function cloneFieldValue(value: FieldValue): FieldValue {
  if (!Array.isArray(value)) {
    return value;
  }

  const structured = value.filter(isStructuredEntry);

  if (structured.length === value.length) {
    return structured.map((entry) => ({
      entryId: entry.entryId,
      values: Object.fromEntries(
        Object.entries(entry.values).map(([key, child]) => [
          key,
          cloneFieldValue(child),
        ]),
      ),
    }));
  }

  return value.filter(
    (item): item is string | number =>
      typeof item === 'string' || typeof item === 'number',
  );
}

function defaultValues(
  type: StructuredFieldType,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};

  for (const child of type.children) {
    if (child.defaultValue !== undefined) {
      values[child.key] = cloneFieldValue(child.defaultValue);
    }
  }

  return values;
}

function isStructuredEntry(value: unknown): value is StructuredFieldEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Partial<StructuredFieldEntry>).entryId === 'string' &&
    typeof (value as Partial<StructuredFieldEntry>).values === 'object'
  );
}

function structuredEntries(value: FieldValue | undefined): StructuredFieldEntry[] {
  return Array.isArray(value) ? value.filter(isStructuredEntry) : [];
}

interface StructuredValueEditorProps {
  readonly type: StructuredFieldType;
  readonly value: FieldValue | undefined;
  readonly depth?: number;
  readonly onChange: (value: FieldValue | undefined) => void;
}

/**
 * Dynamic editor for one structured/repeating field. Entries keep explicit
 * order, child defaults seed new rows, and removing the last entry clears the
 * attribute instead of persisting an empty array.
 */
export function StructuredValueEditor({
  type,
  value,
  depth = 0,
  onChange,
}: StructuredValueEditorProps) {
  const idPrefix = useId();
  const entries = structuredEntries(value);

  function updateEntry(
    entryId: string,
    updater: (entry: StructuredFieldEntry) => StructuredFieldEntry,
  ) {
    onChange(
      entries.map((entry) =>
        entry.entryId === entryId ? updater(entry) : entry,
      ),
    );
  }

  function removeEntry(entryId: string) {
    const next = entries.filter((entry) => entry.entryId !== entryId);
    onChange(next.length === 0 ? undefined : next);
  }

  function addEntry() {
    onChange([
      ...entries,
      {
        entryId: createUniqueId('entry'),
        values: defaultValues(type),
      },
    ]);
  }

  function moveEntry(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= entries.length) {
      return;
    }

    const next = [...entries];
    const current = next[index];
    const target = next[targetIndex];
    if (current === undefined || target === undefined) {
      return;
    }

    next[index] = target;
    next[targetIndex] = current;
    onChange(next);
  }

  function setChildValue(
    entryId: string,
    childKey: string,
    childValue: FieldValue | undefined,
  ) {
    updateEntry(entryId, (entry) => {
      const values = { ...entry.values };
      if (childValue === undefined) {
        delete values[childKey];
      } else {
        values[childKey] = childValue;
      }
      return { ...entry, values };
    });
  }

  function renderChildControl(
    entry: StructuredFieldEntry,
    child: StructuredChildDefinition,
    childIndex: number,
  ) {
    const id = `${idPrefix}-${entry.entryId}-${child.key}-${childIndex}`;
    const childValue = entry.values[child.key];

    switch (child.type.type) {
      case 'text':
        return (
          <input
            id={id}
            className="text-input"
            type="text"
            value={typeof childValue === 'string' ? childValue : ''}
            placeholder={child.required === true ? 'Required' : 'Optional'}
            onChange={(event) =>
              setChildValue(
                entry.entryId,
                child.key,
                event.target.value === '' ? undefined : event.target.value,
              )
            }
          />
        );

      case 'number':
        return (
          <input
            id={id}
            className="text-input"
            type="number"
            step="any"
            value={typeof childValue === 'number' ? String(childValue) : ''}
            placeholder={child.required === true ? 'Required' : 'Optional'}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === '') {
                setChildValue(entry.entryId, child.key, undefined);
                return;
              }

              const parsed = Number(raw);
              setChildValue(
                entry.entryId,
                child.key,
                Number.isFinite(parsed) ? parsed : undefined,
              );
            }}
          />
        );

      case 'boolean':
        return (
          <select
            id={id}
            className="select-input"
            value={
              childValue === true ? 'true' : childValue === false ? 'false' : ''
            }
            onChange={(event) =>
              setChildValue(
                entry.entryId,
                child.key,
                event.target.value === ''
                  ? undefined
                  : event.target.value === 'true',
              )
            }
          >
            <option value="">No value</option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        );

      case 'enum':
        return (
          <select
            id={id}
            className="select-input"
            value={typeof childValue === 'string' ? childValue : ''}
            onChange={(event) =>
              setChildValue(
                entry.entryId,
                child.key,
                event.target.value === '' ? undefined : event.target.value,
              )
            }
          >
            <option value="">
              {child.required === true ? 'Select…' : 'No value'}
            </option>
            {child.type.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'list':
        return (
          <ValueListEditor
            label="Values"
            values={
              Array.isArray(childValue)
                ? childValue.filter(
                    (item): item is string | number =>
                      typeof item === 'string' || typeof item === 'number',
                  )
                : []
            }
            itemType={child.type.itemType}
            placeholder={
              child.type.itemType === 'number'
                ? 'Add a number'
                : 'Add a value'
            }
            onChange={(values) =>
              setChildValue(
                entry.entryId,
                child.key,
                values.length === 0 ? undefined : values,
              )
            }
          />
        );

      case 'structured':
        return depth + 1 < MAX_STRUCTURED_DEPTH ? (
          <StructuredValueEditor
            type={child.type}
            value={childValue}
            depth={depth + 1}
            onChange={(nextValue) =>
              setChildValue(entry.entryId, child.key, nextValue)
            }
          />
        ) : (
          <p className="form-hint">
            Nested structured values are at the maximum supported depth.
          </p>
        );

      default:
        return null;
    }
  }

  return (
    <div className="structured-value-editor">
      <div className="structured-value-editor__heading">
        <span className="form-field__label">Entries</span>
        <button
          type="button"
          className="button button--secondary"
          onClick={addEntry}
        >
          Add entry
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="form-hint">
          No entries yet. Add one to build this structured value.
        </p>
      ) : (
        <ol className="structured-entry-list">
          {entries.map((entry, index) => (
            <li className="structured-entry" key={entry.entryId}>
              <div className="structured-entry__heading">
                <span className="structured-entry__index">{index + 1}</span>
                <span className="structured-entry__count">
                  {type.children.length} field
                  {type.children.length === 1 ? '' : 's'}
                </span>
                <div className="structured-entry__actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    aria-label={`Move entry ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => moveEntry(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    aria-label={`Move entry ${index + 1} down`}
                    disabled={index === entries.length - 1}
                    onClick={() => moveEntry(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => removeEntry(entry.entryId)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="structured-entry__grid">
                {type.children.map((child, childIndex) => {
                  const childId = `${idPrefix}-${entry.entryId}-${child.key}-${childIndex}`;

                  return (
                    <div className="form-field" key={child.key || childIndex}>
                      <label htmlFor={childId}>
                        {child.label.trim().length === 0
                          ? child.key || 'Untitled child'
                          : child.label}
                        {child.required === true ? ' · Required' : ''}
                      </label>
                      {renderChildControl(entry, child, childIndex)}
                    </div>
                  );
                })}
              </div>

              {type.children.length === 0 ? (
                <p className="form-hint">
                  Configure child fields in Game Settings before adding entries.
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
