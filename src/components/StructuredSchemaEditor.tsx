import { useId } from 'react';

import type {
  FieldType,
  StructuredChildDefinition,
  StructuredFieldType,
} from '../types/Game';
import { MAX_STRUCTURED_DEPTH } from '../types/Game';
import { TagListEditor } from './TagListEditor';
import { ValueListEditor } from './ValueListEditor';

const CHILD_TYPE_FACTORIES: Readonly<
  Record<FieldType['type'], () => FieldType>
> = {
  text: () => ({ type: 'text' }),
  number: () => ({ type: 'number' }),
  boolean: () => ({ type: 'boolean' }),
  enum: () => ({ type: 'enum', options: [] }),
  list: () => ({ type: 'list', itemType: 'text' }),
  structured: () => ({ type: 'structured', children: [] }),
};

const CHILD_TYPE_LABELS: Readonly<Record<FieldType['type'], string>> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  enum: 'Enum',
  list: 'List',
  structured: 'Structured entries',
};

function isChildTypeKind(value: string): value is FieldType['type'] {
  return Object.hasOwn(CHILD_TYPE_FACTORIES, value);
}

function createEmptyChild(): StructuredChildDefinition {
  return {
    key: '',
    label: '',
    type: { type: 'text' },
    required: false,
  };
}

interface StructuredSchemaEditorProps {
  readonly type: StructuredFieldType;
  readonly depth?: number;
  readonly onChange: (
    updater: (type: StructuredFieldType) => StructuredFieldType,
  ) => void;
}

/**
 * Edits the repeating entry schema for a structured field. Structured children
 * may nest up to {@link MAX_STRUCTURED_DEPTH} levels.
 */
export function StructuredSchemaEditor({
  type,
  depth = 0,
  onChange,
}: StructuredSchemaEditorProps) {
  const idPrefix = useId();

  function updateChild(
    index: number,
    updater: (child: StructuredChildDefinition) => StructuredChildDefinition,
  ) {
    onChange((current) => ({
      ...current,
      children: current.children.map((child, childIndex) =>
        childIndex === index ? updater(child) : child,
      ),
    }));
  }

  function addChild() {
    onChange((current) => ({
      ...current,
      children: [...current.children, createEmptyChild()],
    }));
  }

  function removeChild(index: number) {
    onChange((current) => ({
      ...current,
      children: current.children.filter(
        (_, childIndex) => childIndex !== index,
      ),
    }));
  }

  function changeChildType(
    index: number,
    kind: FieldType['type'],
  ) {
    updateChild(index, (current) => ({
      ...current,
      type: CHILD_TYPE_FACTORIES[kind](),
      defaultValue: undefined,
    }));
  }

  function renderDefaultControl(
    child: StructuredChildDefinition,
    index: number,
  ) {
    const id = `${idPrefix}-${index}-default`;

    switch (child.type.type) {
      case 'text':
        return (
          <div className="form-field">
            <label htmlFor={id}>Default</label>
            <input
              id={id}
              className="text-input"
              value={
                typeof child.defaultValue === 'string'
                  ? child.defaultValue
                  : ''
              }
              placeholder="Optional"
              onChange={(event) =>
                updateChild(index, (current) => ({
                  ...current,
                  defaultValue:
                    event.target.value === ''
                      ? undefined
                      : event.target.value,
                }))
              }
            />
          </div>
        );

      case 'number':
        return (
          <div className="form-field">
            <label htmlFor={id}>Default</label>
            <input
              id={id}
              className="text-input"
              type="number"
              step="any"
              value={
                typeof child.defaultValue === 'number'
                  ? String(child.defaultValue)
                  : ''
              }
              placeholder="Optional"
              onChange={(event) => {
                const raw = event.target.value;
                const parsed = Number(raw);
                updateChild(index, (current) => ({
                  ...current,
                  defaultValue:
                    raw === '' || !Number.isFinite(parsed)
                      ? undefined
                      : parsed,
                }));
              }}
            />
          </div>
        );

      case 'boolean':
        return (
          <div className="form-field">
            <label htmlFor={id}>Default</label>
            <select
              id={id}
              className="select-input"
              value={
                child.defaultValue === true
                  ? 'true'
                  : child.defaultValue === false
                    ? 'false'
                    : ''
              }
              onChange={(event) =>
                updateChild(index, (current) => ({
                  ...current,
                  defaultValue:
                    event.target.value === ''
                      ? undefined
                      : event.target.value === 'true',
                }))
              }
            >
              <option value="">No default</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </div>
        );

      case 'enum':
        return (
          <div className="form-field">
            <label htmlFor={id}>Default</label>
            <select
              id={id}
              className="select-input"
              value={
                typeof child.defaultValue === 'string'
                  ? child.defaultValue
                  : ''
              }
              onChange={(event) =>
                updateChild(index, (current) => ({
                  ...current,
                  defaultValue:
                    event.target.value === ''
                      ? undefined
                      : event.target.value,
                }))
              }
            >
              <option value="">No default</option>
              {child.type.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );

      case 'list': {
        const values: readonly (string | number)[] = Array.isArray(
          child.defaultValue,
        )
          ? child.defaultValue.filter(
              (item): item is string | number =>
                typeof item === 'string' || typeof item === 'number',
            )
          : [];

        return (
          <ValueListEditor
            label="Default values"
            values={values}
            itemType={child.type.itemType}
            placeholder={
              child.type.itemType === 'number'
                ? 'Add a number'
                : 'Add a value'
            }
            onChange={(nextValues) =>
              updateChild(index, (current) => ({
                ...current,
                defaultValue:
                  nextValues.length === 0 ? undefined : nextValues,
              }))
            }
          />
        );
      }

      case 'structured':
        return (
          <p className="form-hint">
            Configure nested entry defaults on the card, not on the schema.
          </p>
        );

      default:
        return null;
    }
  }

  return (
    <div className="structured-schema">
      <div className="collection-subsection__heading">
        <div>
          <h5>Entry fields</h5>
          <p className="form-hint">
            Each repeated entry contains these typed child fields. Structured
            children can nest up to {MAX_STRUCTURED_DEPTH} levels.
          </p>
        </div>
        <button
          type="button"
          className="button button--secondary"
          onClick={addChild}
        >
          Add child field
        </button>
      </div>

      {type.children.length === 0 ? (
        <p className="profile-editor__empty">
          Add at least one child field, such as a resource and an amount.
        </p>
      ) : (
        <ol className="structured-schema__list">
          {type.children.map((child, index) => {
            const keyId = `${idPrefix}-${index}-key`;
            const labelId = `${idPrefix}-${index}-label`;
            const typeId = `${idPrefix}-${index}-type`;

            return (
              <li className="structured-schema__item" key={index}>
                <div className="structured-schema__heading">
                  <span className="structured-schema__index">
                    {index + 1}
                  </span>
                  <strong>
                    {child.label.trim().length === 0
                      ? 'Untitled child'
                      : child.label}
                  </strong>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => removeChild(index)}
                  >
                    Remove
                  </button>
                </div>

                <div className="structured-schema__grid">
                  <div className="form-field">
                    <label htmlFor={keyId}>Key</label>
                    <input
                      id={keyId}
                      className="text-input"
                      value={child.key}
                      placeholder="resource"
                      onChange={(event) =>
                        updateChild(index, (current) => ({
                          ...current,
                          key: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={labelId}>Label</label>
                    <input
                      id={labelId}
                      className="text-input"
                      value={child.label}
                      placeholder="Resource"
                      onChange={(event) =>
                        updateChild(index, (current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={typeId}>Type</label>
                    <select
                      id={typeId}
                      className="select-input"
                      value={child.type.type}
                      onChange={(event) => {
                        if (isChildTypeKind(event.target.value)) {
                          changeChildType(index, event.target.value);
                        }
                      }}
                    >
                      {Object.entries(CHILD_TYPE_LABELS)
                        .filter(
                          ([kind]) =>
                            kind !== 'structured' ||
                            depth + 1 < MAX_STRUCTURED_DEPTH,
                        )
                        .map(([kind, label]) => (
                          <option key={kind} value={kind}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </div>

                  <label className="checkbox-field structured-schema__required">
                    <input
                      type="checkbox"
                      checked={child.required === true}
                      onChange={(event) =>
                        updateChild(index, (current) => ({
                          ...current,
                          required: event.target.checked,
                        }))
                      }
                    />
                    <span>Required child</span>
                  </label>
                </div>

                {child.type.type === 'enum' ? (
                  <TagListEditor
                    label="Options"
                    values={child.type.options}
                    placeholder="Add an option"
                    onChange={(options) =>
                      updateChild(index, (current) => {
                        if (current.type.type !== 'enum') {
                          return current;
                        }

                        const nextDefault =
                          typeof current.defaultValue === 'string' &&
                          options.includes(current.defaultValue)
                            ? current.defaultValue
                            : undefined;

                        return {
                          ...current,
                          type: { ...current.type, options },
                          defaultValue: nextDefault,
                        };
                      })
                    }
                  />
                ) : null}

                {child.type.type === 'list' ? (
                  <div className="form-field">
                    <label htmlFor={`${idPrefix}-${index}-item-type`}>
                      List item type
                    </label>
                    <select
                      id={`${idPrefix}-${index}-item-type`}
                      className="select-input"
                      value={child.type.itemType}
                      onChange={(event) => {
                        const itemType =
                          event.target.value === 'number'
                            ? 'number'
                            : 'text';
                        updateChild(index, (current) => ({
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
                ) : null}

                {renderDefaultControl(child, index)}

                {child.type.type === 'structured' ? (
                  <StructuredSchemaEditor
                    type={child.type}
                    depth={depth + 1}
                    onChange={(updater) =>
                      updateChild(index, (current) =>
                        current.type.type === 'structured'
                          ? { ...current, type: updater(current.type) }
                          : current,
                      )
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
