import { useId, useMemo, useState } from 'react';

import {
  createEmptyFieldDefinition,
  isProfileDraftDirty,
} from '../profile/profileFactory';
import type { GameProfile } from '../types/Game';
import { validateGameProfile } from '../utils/validation';
import { FieldDefinitionEditor } from './FieldDefinitionEditor';
import { TagListEditor } from './TagListEditor';

interface GameProfileEditorProps {
  readonly draft: GameProfile;
  readonly persistedProfile: GameProfile | null;
  readonly saving: boolean;
  readonly savedAt: string | null;
  readonly storageError: string | null;
  readonly onUpdate: (updater: (draft: GameProfile) => GameProfile) => void;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}

function formatSavedAt(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseRuleValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

let fieldRowSequence = 0;

/** Draft-only identity for an editor row; never persisted with the profile. */
function createFieldRowId(): string {
  fieldRowSequence += 1;
  return `field-row-${fieldRowSequence}`;
}

/**
 * Full game-profile form. Validation runs live against the same runtime guard
 * used for persisted data; save is disabled while any issue remains.
 */
export function GameProfileEditor({
  draft,
  persistedProfile,
  saving,
  savedAt,
  storageError,
  onUpdate,
  onSave,
  onDiscard,
}: GameProfileEditorProps) {
  const nameId = useId();
  const basicsHeadingId = useId();
  const taxonomyHeadingId = useId();
  const fieldsHeadingId = useId();
  const deckHeadingId = useId();

  // Draft-only row identity. Add/remove handlers keep this aligned with the
  // field list, so removing a row cannot transfer local input state to the
  // next row. External draft replacement falls back to a positional key.
  const [fieldRowIds, setFieldRowIds] = useState<readonly string[]>(() =>
    draft.fieldDefinitions.map(() => createFieldRowId()),
  );

  const validation = useMemo(() => validateGameProfile(draft), [draft]);
  const issues = validation.ok ? [] : validation.issues;

  const isDirty = useMemo(
    () => isProfileDraftDirty(persistedProfile, draft),
    [draft, persistedProfile],
  );

  const statusLabel = saving
    ? 'Saving…'
    : !isDirty
      ? 'Saved'
      : persistedProfile === null
        ? 'Not saved'
        : 'Unsaved changes';

  return (
    <form
      className="profile-editor"
      noValidate
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="profile-editor__header">
        <div>
          <p className="eyebrow">Game profile</p>
          <h3>Define the schema behind every card</h3>
          <p>
            Card types, typed fields, and deck limits are stored locally and
            validated before they can drive the card library.
          </p>
        </div>
        <span
          className={`pill ${isDirty ? 'pill--draft' : 'pill--local'}`}
          aria-live="polite"
        >
          {statusLabel}
        </span>
      </div>

      {storageError === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">Could not save locally</p>
          <p>{storageError}</p>
        </div>
      )}

      {issues.length === 0 ? null : (
        <div className="validation-banner" role="status" aria-live="polite">
          <p className="validation-banner__title">
            {issues.length} issue{issues.length === 1 ? '' : 's'} to fix before
            saving
          </p>
          <ul>
            {issues.slice(0, 5).map((issue, index) => (
              <li key={`${issue.code}-${issue.path}-${index}`}>
                {issue.message}
              </li>
            ))}
          </ul>
          {issues.length > 5 ? (
            <p className="validation-banner__more">
              +{issues.length - 5} more…
            </p>
          ) : null}
        </div>
      )}

      <section
        className="profile-editor__section"
        aria-labelledby={basicsHeadingId}
      >
        <div className="profile-editor__section-header">
          <div>
            <p className="eyebrow">Identity</p>
            <h4 id={basicsHeadingId}>Profile basics</h4>
            <p>Name the game profile shown throughout the workspace.</p>
          </div>
        </div>

        <div className="profile-grid">
          <div className="form-field">
            <label htmlFor={nameId}>Profile name</label>
            <input
              id={nameId}
              className="text-input"
              value={draft.name}
              placeholder="Fantasy TCG"
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <p className="form-hint">
              This is the game profile name, not the project name.
            </p>
          </div>
        </div>
      </section>

      <section
        className="profile-editor__section"
        aria-labelledby={taxonomyHeadingId}
      >
        <div className="profile-editor__section-header">
          <div>
            <p className="eyebrow">Taxonomy</p>
            <h4 id={taxonomyHeadingId}>Card types, subtypes & keywords</h4>
            <p>
              These lists drive card classification, filters, and keyword
              highlighting.
            </p>
          </div>
        </div>

        <div className="profile-grid profile-grid--three">
          <TagListEditor
            label="Card types"
            description="At least one type is required to unlock card creation later."
            values={draft.cardTypes}
            placeholder="Creature"
            onChange={(values) =>
              onUpdate((current) => ({ ...current, cardTypes: values }))
            }
          />

          <TagListEditor
            label="Subtypes"
            description="Validated against card subtype assignments."
            values={draft.subtypes}
            placeholder="Dragon"
            onChange={(values) =>
              onUpdate((current) => ({ ...current, subtypes: values }))
            }
          />

          <TagListEditor
            label="Keywords"
            description="Global keyword library for rules text."
            values={draft.keywords}
            placeholder="Flying"
            onChange={(values) =>
              onUpdate((current) => ({ ...current, keywords: values }))
            }
          />
        </div>

        {draft.cardTypes.length === 0 ? (
          <p className="form-hint">Add a card type to finish profile setup.</p>
        ) : null}
      </section>

      <section
        className="profile-editor__section"
        aria-labelledby={fieldsHeadingId}
      >
        <div className="profile-editor__section-header">
          <div>
            <p className="eyebrow">Schema</p>
            <h4 id={fieldsHeadingId}>Field definitions</h4>
            <p>
              Every card form is generated from these typed fields and their
              defaults.
            </p>
          </div>

          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setFieldRowIds((current) => [
                ...current,
                createFieldRowId(),
              ]);
              onUpdate((current) => ({
                ...current,
                fieldDefinitions: [
                  ...current.fieldDefinitions,
                  createEmptyFieldDefinition(),
                ],
              }));
            }}
          >
            Add field
          </button>
        </div>

        {draft.fieldDefinitions.length === 0 ? (
          <p className="profile-editor__empty">
            No fields defined yet. Cards can still use core properties like name,
            rules text, and artwork; add fields for game-specific stats.
          </p>
        ) : (
          <div className="field-list">
            {draft.fieldDefinitions.map((field, index) => (
              <FieldDefinitionEditor
                key={fieldRowIds[index] ?? `field-${index}`}
                field={field}
                index={index}
                cardTypes={draft.cardTypes}
                issues={issues}
                onChange={(updater) =>
                  onUpdate((current) => ({
                    ...current,
                    fieldDefinitions: current.fieldDefinitions.map(
                      (item, itemIndex) =>
                        itemIndex === index ? updater(item) : item,
                    ),
                  }))
                }
                onRemove={() => {
                  setFieldRowIds((current) =>
                    current.filter(
                      (_, rowIndex) => rowIndex !== index,
                    ),
                  );
                  onUpdate((current) => ({
                    ...current,
                    fieldDefinitions: current.fieldDefinitions.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  }));
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section
        className="profile-editor__section"
        aria-labelledby={deckHeadingId}
      >
        <div className="profile-editor__section-header">
          <div>
            <p className="eyebrow">Deck rules</p>
            <h4 id={deckHeadingId}>Deck-building limits</h4>
            <p>
              These values produce soft warnings in v1; they never block
              editing.
            </p>
          </div>
        </div>

        <div className="profile-grid profile-grid--three">
          <div className="form-field">
            <label htmlFor={`${deckHeadingId}-min`}>Minimum deck size</label>
            <input
              id={`${deckHeadingId}-min`}
              className="text-input"
              type="number"
              min={0}
              step={1}
              value={draft.deckRules.minSize}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  deckRules: {
                    ...current.deckRules,
                    minSize: parseRuleValue(event.target.value),
                  },
                }))
              }
            />
          </div>

          <div className="form-field">
            <label htmlFor={`${deckHeadingId}-max`}>Maximum deck size</label>
            <input
              id={`${deckHeadingId}-max`}
              className="text-input"
              type="number"
              min={0}
              step={1}
              value={draft.deckRules.maxSize}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  deckRules: {
                    ...current.deckRules,
                    maxSize: parseRuleValue(event.target.value),
                  },
                }))
              }
            />
          </div>

          <div className="form-field">
            <label htmlFor={`${deckHeadingId}-copies`}>
              Max copies per card
            </label>
            <input
              id={`${deckHeadingId}-copies`}
              className="text-input"
              type="number"
              min={1}
              step={1}
              value={draft.deckRules.maxCopiesPerCard}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  deckRules: {
                    ...current.deckRules,
                    maxCopiesPerCard: parseRuleValue(event.target.value),
                  },
                }))
              }
            />
          </div>
        </div>
      </section>

      <div className="profile-editor__footer">
        <p className="profile-editor__status">
          {savedAt === null
            ? persistedProfile === null
              ? 'Nothing has been saved to this browser yet.'
              : 'Loaded from this browser.'
            : `Saved locally at ${formatSavedAt(savedAt)}.`}
          {isDirty ? ' Unsaved changes.' : ''}
        </p>

        <div className="profile-editor__actions">
          {persistedProfile === null ? null : (
            <button
              type="button"
              className="button button--ghost"
              onClick={onDiscard}
              disabled={!isDirty || saving}
            >
              Discard changes
            </button>
          )}

          <button
            type="submit"
            className="button button--primary"
            disabled={saving || issues.length > 0 || !isDirty}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </form>
  );
}
