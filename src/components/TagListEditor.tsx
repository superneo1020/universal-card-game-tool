import { useId, useState } from 'react';

interface TagListEditorProps {
  readonly label: string;
  readonly description?: string;
  readonly values: readonly string[];
  readonly placeholder: string;
  readonly onChange: (values: string[]) => void;
}

/**
 * Chip-style string list editor used for card types, subtypes, keywords, and
 * enum options. Values are unique and trimmed; duplicates are ignored.
 */
export function TagListEditor({
  label,
  description,
  values,
  placeholder,
  onChange,
}: TagListEditorProps) {
  const inputId = useId();
  const [inputValue, setInputValue] = useState('');

  function addValue() {
    const candidate = inputValue.trim();

    if (candidate.length === 0) {
      return;
    }

    if (!values.includes(candidate)) {
      onChange([...values, candidate]);
    }

    setInputValue('');
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
          {values.map((value) => (
            <li className="chip" key={value}>
              <span>{value}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
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
          placeholder={placeholder}
          onChange={(event) => setInputValue(event.target.value)}
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
    </div>
  );
}
