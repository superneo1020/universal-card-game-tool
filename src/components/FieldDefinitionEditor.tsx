import { useId, useState } from 'react';

import type { FieldDefinition, FieldType } from '../types/Game';
import type { ValidationIssue } from '../utils/validation';
import { StructuredSchemaEditor } from './StructuredSchemaEditor';
import { TagListEditor } from './TagListEditor';
import { ValueListEditor } from './ValueListEditor';

const FIELD_TYPE_FACTORIES: Readonly<Record<FieldType['type'], () => FieldType>> = {
  text: () => ({ type: 'text' }),
  number: () => ({ type: 'number' }),
  boolean: () => ({ type: 'boolean' }),
  enum: () => ({ type: 'enum', options: [] }),
  list: () => ({ type: 'list', itemType: 'text' }),
  structured: () => ({ type: 'structured', children: [] }),
};

const FIELD_TYPE_LABELS: Readonly<Record<FieldType['type'], string>> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  enum: 'Enum',
  list: 'List',
  structured: 'Structured entries',
};

function isFieldTypeKind(value: string): value is FieldType['type'] {
  return Object.hasOwn(FIELD_TYPE_FACTORIES, value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled field type: ${String(value)}`);
}

interface FieldDefinitionEditorProps {
  readonly field: FieldDefinition;
  readonly index: number;
  readonly cardTypes: readonly string[];
  readonly issues: readonly ValidationIssue[];
  readonly onChange: (updater: (field: FieldDefinition) => FieldDefinition) => void;
  readonly onRemove: () => void;
}

/**
 * Edits one runtime field definition, including its discriminated type,
 * optional default value, and card-type applicability.
 */
export function FieldDefinitionEditor({
  field,
  index,
  cardTypes,
  issues,
  onChange,
  onRemove,
}: FieldDefinitionEditorProps) {
  const keyId = useId();
  const labelId = useId();
  const typeId = useId();
  const targetId = useId();
  const requiredId = useId();
  const defaultId = useId();
  const bodyId = useId();
  const [collapsed, setCollapsed] = useState(false);

  const appliesToAll =
    field.cardTypes === undefined || field.cardTypes.length === 0;
  const fieldIssues = issues.filter((issue) =>
    issue.path.startsWith(`$.fieldDefinitions[${index}]`),
  );

  function update(patch: Partial<FieldDefinition>) {
    onChange((current) => ({ ...current, ...patch }));
  }

  function toggleCardType(cardType: string) {
    const current = field.cardTypes ?? [];
    const next = current.includes(cardType)
      ? current.filter((item) => item !== cardType)
      : [...current, cardType];
    update({ cardTypes: next.length === 0 ? undefined : next });
  }

  function changeType(kind: FieldType['type']) {
    onChange((current) => ({
      ...current,
      type: FIELD_TYPE_FACTORIES[kind](),
      defaultValue: undefined,
    }));
  }

  function renderDefaultControl() {
    switch (field.type.type) {
      case 'text':
        return (
          <div className="form-field">
            <label htmlFor={defaultId}>Default value</label>
            <input
              id={defaultId}
              className="text-input"
              type="text"
              value={
                typeof field.defaultValue === 'string' ? field.defaultValue : ''
              }
              placeholder="Optional default"
              onChange={(event) =>
                update({
                  defaultValue:
                    event.target.value === '' ? undefined : event.target.value,
                })
              }
            />
          </div>
        );

      case 'number':
        return (
          <div className="form-field">
            <label htmlFor={defaultId}>Default value</label>
            <input
              id={defaultId}
              className="text-input"
              type="number"
              step="any"
              value={
                typeof field.defaultValue === 'number'
                  ? String(field.defaultValue)
                  : ''
              }
              placeholder="Optional default"
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === '') {
                  update({ defaultValue: undefined });
                  return;
                }

                const parsed = Number(raw);
                update({
                  defaultValue: Number.isFinite(parsed) ? parsed : undefined,
                });
              }}
            />
          </div>
        );

      case 'boolean':
        return (
          <div className="form-field">
            <label htmlFor={defaultId}>Default value</label>
            <select
              id={defaultId}
              className="select-input"
              value={
                field.defaultValue === true
                  ? 'true'
                  : field.defaultValue === false
                    ? 'false'
                    : ''
              }
              onChange={(event) => {
                const value = event.target.value;
                update({
                  defaultValue:
                    value === '' ? undefined : value === 'true',
                });
              }}
            >
              <option value="">No default</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </div>
        );

      case 'enum': {
        const options = field.type.options;

        return (
          <div className="field-default-stack">
            <TagListEditor
              label="Options"
              values={options}
              placeholder="Add an option"
              onChange={(nextOptions) => {
                onChange((current) => {
                  if (current.type.type !== 'enum') {
                    return current;
                  }

                  const nextDefault =
                    typeof current.defaultValue === 'string' &&
                    nextOptions.includes(current.defaultValue)
                      ? current.defaultValue
                      : undefined;

                  return {
                    ...current,
                    type: { ...current.type, options: nextOptions },
                    defaultValue: nextDefault,
                  };
                });
              }}
            />

            <div className="form-field">
              <label htmlFor={defaultId}>Default value</label>
              <select
                id={defaultId}
                className="select-input"
                value={
                  typeof field.defaultValue === 'string'
                    ? field.defaultValue
                    : ''
                }
                onChange={(event) =>
                  update({
                    defaultValue:
                      event.target.value === ''
                        ? undefined
                        : event.target.value,
                  })
                }
              >
                <option value="">No default</option>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      }

      case 'list': {
        const values: readonly (string | number)[] = Array.isArray(
          field.defaultValue,
        )
          ? field.defaultValue.filter(
              (item): item is string | number =>
                typeof item === 'string' || typeof item === 'number',
            )
          : [];

        return (
          <div className="field-default-stack">
            <div className="form-field">
              <label htmlFor={`${defaultId}-item-type`}>Item type</label>
              <select
                id={`${defaultId}-item-type`}
                className="select-input"
                value={field.type.itemType}
                onChange={(event) => {
                  const itemType =
                    event.target.value === 'number' ? 'number' : 'text';

                  onChange((current) => ({
                    ...current,
                    type: { type: 'list', itemType },
                    defaultValue: undefined,
                  }));
                }}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
              </select>
            </div>

            <ValueListEditor
              label="Default values"
              values={values}
              itemType={field.type.itemType}
              placeholder={
                field.type.itemType === 'number'
                  ? 'Add a number'
                  : 'Add a value'
              }
              onChange={(nextValues) =>
                update({
                  defaultValue:
                    nextValues.length === 0 ? undefined : nextValues,
                })
              }
            />
          </div>
        );
      }

      case 'structured':
        return (
          <p className="form-hint">
            Default entries are configured on the card, not on the field
            definition.
          </p>
        );

      default:
        return assertNever(field.type);
    }
  }

  return (
    <article className="field-card">
      <div className="field-card__header">
        <div className="field-card__title">
          <span className="field-card__index" aria-hidden="true">
            {index + 1}
          </span>
          <div>
            <p className="field-card__label">
              {field.label.trim().length === 0
                ? 'Untitled field'
                : field.label}
            </p>
            <p className="field-card__meta">
              {FIELD_TYPE_LABELS[field.type.type]} ·{' '}
              {field.target === 'root' ? 'Card root' : 'Card face'}
              {fieldIssues.length > 0
                ? ` · ${fieldIssues.length} issue${fieldIssues.length === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>
        </div>

        <div className="field-card__actions">
          <button
            type="button"
            className="button button--ghost"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            type="button"
            className="button button--danger-ghost"
            onClick={onRemove}
            aria-label={`Remove field ${field.label.trim().length === 0 ? index + 1 : field.label}`}
          >
            Remove
          </button>
        </div>
      </div>

      <div id={bodyId} className="field-card__body" hidden={collapsed}>
        <div className="field-grid">
        <div className="form-field">
          <label htmlFor={keyId}>Key</label>
          <input
            id={keyId}
            className="text-input"
            value={field.key}
            placeholder="attack"
            onChange={(event) => update({ key: event.target.value })}
          />
          <p className="form-hint">Stored as the card attribute key.</p>
        </div>

        <div className="form-field">
          <label htmlFor={labelId}>Label</label>
          <input
            id={labelId}
            className="text-input"
            value={field.label}
            placeholder="Attack"
            onChange={(event) => update({ label: event.target.value })}
          />
        </div>

        <div className="form-field">
          <label htmlFor={typeId}>Type</label>
          <select
            id={typeId}
            className="select-input"
            value={field.type.type}
            onChange={(event) => {
              if (isFieldTypeKind(event.target.value)) {
                changeType(event.target.value);
              }
            }}
          >
            {Object.entries(FIELD_TYPE_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor={targetId}>Target</label>
          <select
            id={targetId}
            className="select-input"
            value={field.target}
            onChange={(event) =>
              update({
                target: event.target.value === 'root' ? 'root' : 'face',
              })
            }
          >
            <option value="face">Card face</option>
            <option value="root">Card root</option>
          </select>
        </div>

        <label className="checkbox-field" htmlFor={requiredId}>
          <input
            id={requiredId}
            type="checkbox"
            checked={field.required === true}
            onChange={(event) => update({ required: event.target.checked })}
          />
          <span>Required field</span>
        </label>
      </div>

      {field.type.type === 'structured' ? (
        <StructuredSchemaEditor
          type={field.type}
          onChange={(updater) =>
            onChange((current) =>
              current.type.type === 'structured'
                ? { ...current, type: updater(current.type) }
                : current,
            )
          }
        />
      ) : null}

      <div className="form-field">
        <span className="form-field__label">Applies to card types</span>
        <div className="toggle-chips">
          <button
            type="button"
            className={`toggle-chip${appliesToAll ? ' toggle-chip--active' : ''}`}
            aria-pressed={appliesToAll}
            onClick={() => update({ cardTypes: undefined })}
          >
            All card types
          </button>
          {cardTypes.map((cardType) => {
            const active = field.cardTypes?.includes(cardType) ?? false;
            return (
              <button
                key={cardType}
                type="button"
                className={`toggle-chip${active ? ' toggle-chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleCardType(cardType)}
              >
                {cardType}
              </button>
            );
          })}
        </div>
        <p className="form-hint">
          {appliesToAll
            ? 'Shown on every card type. '
            : `Only shown for: ${field.cardTypes?.join(', ') ?? ''}. `}
          {field.target === 'root'
            ? 'Root fields use the card-level type; face overrides never change them.'
            : 'Face fields use the active face type override when present.'}
        </p>
      </div>

      <div className="field-card__default">{renderDefaultControl()}</div>

        {fieldIssues.length === 0 ? null : (
          <ul className="field-card__issues">
            {fieldIssues.map((issue, issueIndex) => (
              <li key={`${issue.code}-${issue.path}-${issueIndex}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
