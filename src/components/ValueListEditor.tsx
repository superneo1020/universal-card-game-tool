import { useId, useState } from 'react';

interface ValueListEditorProps {
  readonly label: string;
  readonly description?: string;
  readonly values: readonly (string | number)[];
  readonly itemType: 'text' | 'number';
  readonly placeholder: string;
  readonly onChange: (values: (string | number)[]) => void;
}

/**
 * Chip-style editor for flat list defaults. Numeric lists reject non-finite
 * input rather than silently storing `NaN`.
 */
export function ValueListEditor({
  label,
  description,
  values,
  itemType,
  placeholder,
  onChange,
}: ValueListEditorProps) {
  const inputId = useId();
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  function parseValue(candidate: string): string | number | null {
    if (itemType === 'text') {
      return candidate;
    }

    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function addValue() {
    const candidate = inputValue.trim();

    if (candidate.length === 0) {
      return;
    }

    const parsed = parseValue(candidate);
    if (parsed === null) {
      setInputError('Enter a finite number.');
      return;
    }

    if (!values.includes(parsed)) {
      onChange([...values, parsed]);
    }

    setInputValue('');
    setInputError(null);
  }

  return (
    <div className="tag-editor">
      <div className="tag-editor__heading">
        <label className="tag-editor__label" htmlFor={inputId}>
          {label}
        </label>
        <span className="tag-editor__count">{values.length}</span>
      </div>

      {description === undefined ? null : (
        <p className="tag-editor__description">{description}</p>
      )}

      {values.length === 0 ? (
        <p className="tag-editor__empty">None added yet.</p>
      ) : (
        <ul className="tag-editor__chips">
          {values.map((value, index) => (
            <li className="chip" key={`${typeof value}-${String(value)}`}>
              <span>{String(value)}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`Remove ${String(value)}`}
                onClick={() =>
                  onChange(values.filter((_, valueIndex) => valueIndex !== index))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="inline-form">
        <input
          id={inputId}
          className="text-input"
          value={inputValue}
          inputMode={itemType === 'number' ? 'decimal' : 'text'}
          placeholder={placeholder}
          aria-invalid={inputError !== null}
          aria-describedby={inputError === null ? undefined : `${inputId}-error`}
          onChange={(event) => {
            setInputValue(event.target.value);
            setInputError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addValue();
            }
          }}
        />
        <button
          type="button"
          className="button button--secondary"
          onClick={addValue}
          disabled={inputValue.trim().length === 0}
        >
          Add
        </button>
      </div>

      {inputError === null ? null : (
        <p className="form-error" id={`${inputId}-error`} role="alert">
          {inputError}
        </p>
      )}
    </div>
  );
}
