import { useId, useMemo, useState } from 'react';

import {
  createCardDraft,
  createCardFace,
  formatFieldValue,
  getCardFace,
  getCardFaceById,
  reconcileCard,
  seedDefaultsForCardType,
  seedDefaultsForFaceType,
  setCardAttributeValue,
  updateCardFaceById,
} from '../../cards/cardModel';
import type { CardFieldState } from '../../cards/cardModel';
import type { ArtworkImportResult } from '../../hooks/useProject';
import type { CardTemplate } from '../../types/Card';
import type { CardRecord, FieldValue } from '../../types/CardRecord';
import type { FieldDefinition, GameProfile } from '../../types/Game';
import type { AssetReference } from '../../types/ProjectManifest';
import type { ValidationIssue } from '../../utils/validation';
import { TagListEditor } from '../TagListEditor';
import { ValueListEditor } from '../ValueListEditor';
import { ArtworkPicker } from './ArtworkPicker';
import { CardPreview } from './CardPreview';
import { StructuredValueEditor } from './StructuredValueEditor';

function assertNever(value: never): never {
  throw new Error(`Unhandled field type: ${String(value)}`);
}

type CardEditorSection = 'identity' | 'rules' | 'stats' | 'artwork';

const CARD_EDITOR_SECTIONS: readonly {
  readonly id: CardEditorSection;
  readonly label: string;
}[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'rules', label: 'Rules' },
  { id: 'stats', label: 'Stats' },
  { id: 'artwork', label: 'Artwork' },
];

function sectionForIssue(path: string): CardEditorSection {
  if (path.includes('rulesText') || path.includes('flavorText')) {
    return 'rules';
  }

  if (path.includes('artAssetId') || path.includes('fullCardAssetId')) {
    return 'artwork';
  }

  if (path.includes('rootAttributes') || path.includes('faceAttributes')) {
    return 'stats';
  }

  return 'identity';
}

function sectionLabel(section: CardEditorSection): string {
  return CARD_EDITOR_SECTIONS.find((item) => item.id === section)?.label ?? 'Identity';
}

interface CardFieldControlProps {
  readonly state: CardFieldState;
  readonly onChange: (value: FieldValue | undefined) => void;
}

/** Renders one profile field as the appropriate typed control. */
function CardFieldControl({ state, onChange }: CardFieldControlProps) {
  const inputId = useId();
  const { definition, value, issues } = state;
  const required = definition.required === true;
  const isList = definition.type.type === 'list';

  function renderControl() {
    switch (definition.type.type) {
      case 'text':
        return (
          <input
            id={inputId}
            className="text-input"
            type="text"
            value={typeof value === 'string' ? value : ''}
            placeholder={required ? 'Required' : 'Optional'}
            onChange={(event) =>
              onChange(
                event.target.value === '' ? undefined : event.target.value,
              )
            }
          />
        );

      case 'number':
        return (
          <input
            id={inputId}
            className="text-input"
            type="number"
            step="any"
            value={typeof value === 'number' ? String(value) : ''}
            placeholder={required ? 'Required' : 'Optional'}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === '') {
                onChange(undefined);
                return;
              }

              const parsed = Number(raw);
              onChange(Number.isFinite(parsed) ? parsed : undefined);
            }}
          />
        );

      case 'boolean':
        return (
          <select
            id={inputId}
            className="select-input"
            value={
              value === true ? 'true' : value === false ? 'false' : ''
            }
            onChange={(event) =>
              onChange(
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
            id={inputId}
            className="select-input"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) =>
              onChange(
                event.target.value === '' ? undefined : event.target.value,
              )
            }
          >
            <option value="">{required ? 'Select…' : 'No value'}</option>
            {definition.type.options.map((option) => (
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
              Array.isArray(value)
                ? value.filter(
                    (item): item is string | number =>
                      typeof item === 'string' || typeof item === 'number',
                  )
                : []
            }
            itemType={definition.type.itemType}
            placeholder={
              definition.type.itemType === 'number'
                ? 'Add a number'
                : 'Add a value'
            }
            onChange={(values) =>
              onChange(values.length === 0 ? undefined : values)
            }
          />
        );

      case 'structured':
        return (
          <StructuredValueEditor
            type={definition.type}
            value={value}
            onChange={onChange}
          />
        );

      default:
        return assertNever(definition.type);
    }
  }

  return (
    <div className="card-field">
      <div className="card-field__header">
        {isList ? (
          <span className="card-field__label">{definition.label}</span>
        ) : (
          <label className="card-field__label" htmlFor={inputId}>
            {definition.label}
          </label>
        )}
        <span className="card-field__meta-group">
          <span className="card-field__meta">
            <code>{definition.key}</code>
            {required ? ' · Required' : ''} · {definition.target}
          </span>
          {value === undefined ? null : (
            <button
              type="button"
              className="card-field__clear"
              onClick={() => onChange(undefined)}
            >
              Clear
            </button>
          )}
        </span>
      </div>

      {renderControl()}

      {issues.length === 0 ? null : (
        <p className="form-error">{issues[0].message}</p>
      )}
    </div>
  );
}

interface CardEditorProps {
  readonly profile: GameProfile;
  readonly templates: readonly CardTemplate[];
  readonly assets: readonly AssetReference[];
  readonly initialCard: CardRecord | null;
  readonly saving: boolean;
  readonly onSave: (card: CardRecord) => void;
  readonly onImportArtwork: (
    files: readonly File[],
  ) => Promise<ArtworkImportResult>;
  readonly onCancel: () => void;
}

/**
 * Profile-driven card form. Core properties are explicit; every dynamic field
 * is generated from the active profile. Orphaned values are preserved and can
 * be removed explicitly.
 */
export function CardEditor({
  profile,
  templates,
  assets,
  initialCard,
  saving,
  onSave,
  onImportArtwork,
  onCancel,
}: CardEditorProps) {
  const nameId = useId();
  const typeId = useId();
  const templateId = useId();
  const faceNameId = useId();
  const faceTypeId = useId();
  const rulesId = useId();
  const flavorId = useId();

  const [draft, setDraft] = useState<CardRecord>(() =>
    initialCard === null
      ? createCardDraft(profile)
      : structuredClone(initialCard),
  );
  const [activeFaceId, setActiveFaceId] = useState(
    () => draft.faces[0]?.faceId ?? 'front',
  );
  const [activeSection, setActiveSection] =
    useState<CardEditorSection>('identity');
  const [showLivePreview, setShowLivePreview] = useState(true);

  const reconciliation = useMemo(
    () => reconcileCard(draft, profile),
    [draft, profile],
  );
  const activeFace = getCardFaceById(draft, activeFaceId) ?? getCardFace(draft);
  const activeFaceReconciliation =
    reconciliation.faces.find((face) => face.faceId === activeFace.faceId) ??
    reconciliation.faces[0];
  const activeTemplate =
    templates.find((template) => template.id === draft.templateId) ?? null;
  const templateValid = activeTemplate !== null;
  const templateIssue: ValidationIssue | null = templateValid
    ? null
    : {
        path: '$.templateId',
        code: 'unresolved_reference',
        message:
          'This card references a template that is not in the project.',
      };
  const validationIssues =
    templateIssue === null
      ? reconciliation.issues
      : [templateIssue, ...reconciliation.issues];
  const canSave = validationIssues.length === 0;
  const rootFields = reconciliation.fields.filter(
    (field) => field.definition.target === 'root',
  );
  const faceFields = activeFaceReconciliation?.fields ?? [];
  const effectiveFaceType = activeFace.cardType ?? draft.cardType;
  const effectiveFaceSubtypes = activeFace.subtypes ?? draft.subtypes;
  const orphanedSubtypes = draft.subtypes.filter(
    (subtype) => !profile.subtypes.includes(subtype),
  );
  const orphanedFaceSubtypes = effectiveFaceSubtypes.filter(
    (subtype) => !profile.subtypes.includes(subtype),
  );

  function updateAttribute(
    target: FieldDefinition['target'],
    key: string,
    value: FieldValue | undefined,
    faceId: string = activeFace.faceId,
  ) {
    setDraft((current) =>
      setCardAttributeValue(current, target, key, value, faceId),
    );
  }

  function updateFace(
    patch: Partial<
      Pick<
        CardRecord['faces'][number],
        | 'name'
        | 'cardType'
        | 'subtypes'
        | 'rulesText'
        | 'flavorText'
        | 'artAssetId'
        | 'fullCardAssetId'
      >
    >,
  ) {
    setDraft((current) =>
      updateCardFaceById(current, activeFace.faceId, patch),
    );
  }

  function addFace() {
    const face = createCardFace(profile, undefined, draft.cardType);
    setDraft((current) => ({
      ...current,
      faces: [...current.faces, face],
    }));
    setActiveFaceId(face.faceId);
  }

  function removeActiveFace() {
    if (draft.faces.length <= 1) {
      return;
    }

    const remaining = draft.faces.filter(
      (face) => face.faceId !== activeFace.faceId,
    );
    setDraft((current) => ({
      ...current,
      faces: current.faces.filter(
        (face) => face.faceId !== activeFace.faceId,
      ),
    }));
    setActiveFaceId(remaining[0]?.faceId ?? 'front');
  }

  function toggleSubtype(subtype: string) {
    setDraft((current) => ({
      ...current,
      subtypes: current.subtypes.includes(subtype)
        ? current.subtypes.filter((item) => item !== subtype)
        : [...current.subtypes, subtype],
    }));
  }

  function toggleFaceSubtype(subtype: string) {
    const current = effectiveFaceSubtypes;
    const next = current.includes(subtype)
      ? current.filter((item) => item !== subtype)
      : [...current, subtype];
    updateFace({ subtypes: next });
  }

  function changeCardType(cardType: string) {
    setDraft((current) =>
      seedDefaultsForCardType(current, profile, cardType),
    );
  }

  function changeFaceType(cardType: string | undefined) {
    setDraft((current) =>
      seedDefaultsForFaceType(current, profile, activeFace.faceId, cardType),
    );
  }

  return (
    <form
      className="card-editor"
      noValidate
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && canSave) {
          onSave(draft);
        }
      }}
    >
      <div className="card-editor__header">
        <div>
          <p className="eyebrow">
            {initialCard === null ? 'New card' : 'Edit card'}
          </p>
          <h3>{draft.name.trim().length === 0 ? 'Untitled card' : draft.name}</h3>
          <p className="form-hint">
            Fields below are generated from the saved game profile.
          </p>
        </div>
        <span className={`pill ${canSave ? 'pill--local' : 'pill--draft'}`}>
          {canSave ? 'Ready to save' : 'Needs attention'}
        </span>
      </div>

      {saving ? (
        <p className="form-hint" role="status">
          Saving card…
        </p>
      ) : null}

      <fieldset className="card-editor__fieldset" disabled={saving}>
        <div className="card-editor__layout">
          <div className="card-editor__main">
            <div className="card-editor__face-bar">
              <div className="face-tabs" role="tablist" aria-label="Card faces">
                {draft.faces.map((cardFace, index) => {
                  const selected = cardFace.faceId === activeFace.faceId;

                  return (
                    <button
                      key={cardFace.faceId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`face-tab${selected ? ' face-tab--active' : ''}`}
                      onClick={() => setActiveFaceId(cardFace.faceId)}
                    >
                      {cardFace.name?.trim().length
                        ? cardFace.name
                        : `Face ${index + 1}`}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="face-tab face-tab--add"
                  onClick={addFace}
                >
                  + Add face
                </button>
                {draft.faces.length <= 1 ? null : (
                  <button
                    type="button"
                    className="face-tab face-tab--danger"
                    onClick={removeActiveFace}
                  >
                    Remove face
                  </button>
                )}
              </div>
            </div>

            <div
              className="card-editor__section-tabs"
              role="tablist"
              aria-label="Card editor sections"
            >
              {CARD_EDITOR_SECTIONS.map((section) => {
                const selected = activeSection === section.id;

                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    id={`card-editor-tab-${section.id}`}
                    aria-controls={`card-editor-panel-${section.id}`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    className={`card-editor__section-tab${selected ? ' card-editor__section-tab--active' : ''}`}
                    onClick={() => setActiveSection(section.id)}
                    onKeyDown={(event) => {
                      const index = CARD_EDITOR_SECTIONS.findIndex(
                        (item) => item.id === section.id,
                      );
                      const direction =
                        event.key === 'ArrowRight'
                          ? 1
                          : event.key === 'ArrowLeft'
                            ? -1
                            : 0;

                      if (direction === 0) {
                        return;
                      }

                      event.preventDefault();
                      const nextIndex =
                        (index + direction + CARD_EDITOR_SECTIONS.length) %
                        CARD_EDITOR_SECTIONS.length;
                      const nextSection = CARD_EDITOR_SECTIONS[nextIndex];
                      if (nextSection !== undefined) {
                        setActiveSection(nextSection.id);
                        document
                          .getElementById(
                            `card-editor-tab-${nextSection.id}`,
                          )
                          ?.focus();
                      }
                    }}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>

            {activeSection === 'identity' ? (
              <section
                className="card-editor__section"
                id="card-editor-panel-identity"
                role="tabpanel"
                aria-labelledby="card-editor-tab-identity"
              >
                <div className="profile-editor__section-header">
                  <div>
                    <p className="eyebrow">Identity</p>
                    <h4>Card identity</h4>
                    <p>
                      Name, type, template, and face classification. These
                      properties sit outside the dynamic field schema.
                    </p>
                  </div>
                </div>

          <div className="card-editor__grid">
            <div className="form-field">
              <label htmlFor={nameId}>Name</label>
              <input
                id={nameId}
                className="text-input"
                value={draft.name}
                placeholder="Card name"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>

            <div className="form-field">
              <label htmlFor={typeId}>Card type</label>
              <select
                id={typeId}
                className="select-input"
                value={draft.cardType}
                onChange={(event) => changeCardType(event.target.value)}
              >
                {draft.cardType.trim().length === 0 ? (
                  <option value="" disabled>
                    Select a card type
                  </option>
                ) : null}
                {!profile.cardTypes.includes(draft.cardType) &&
                draft.cardType.trim().length > 0 ? (
                  <option value={draft.cardType} disabled>
                    {draft.cardType} (not in profile)
                  </option>
                ) : null}
                {profile.cardTypes.map((cardType) => (
                  <option key={cardType} value={cardType}>
                    {cardType}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor={templateId}>Template</label>
              <select
                id={templateId}
                className="select-input"
                value={draft.templateId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    templateId: event.target.value,
                  }))
                }
              >
                {!templateValid ? (
                  <option value={draft.templateId} disabled>
                    Missing template
                  </option>
                ) : null}
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name.trim().length === 0
                      ? 'Untitled template'
                      : template.name}
                  </option>
                ))}
              </select>
              {templateValid ? null : (
                <p className="form-error">
                  This card references a template that is not in the project.
                </p>
              )}
            </div>
          </div>

          <div className="form-field">
            <label htmlFor={faceNameId}>Face name (optional)</label>
            <input
              id={faceNameId}
              className="text-input"
              value={activeFace.name ?? ''}
              placeholder="e.g. Front"
              onChange={(event) =>
                updateFace({
                  name:
                    event.target.value === ''
                      ? undefined
                      : event.target.value,
                })
              }
            />
          </div>

          <div className="form-field">
            <label htmlFor={faceTypeId}>Face type override</label>
            <select
              id={faceTypeId}
              className="select-input"
              value={activeFace.cardType ?? ''}
              onChange={(event) =>
                changeFaceType(
                  event.target.value === ''
                    ? undefined
                    : event.target.value,
                )
              }
            >
              <option value="">
                Same as card
                {draft.cardType.trim().length === 0
                  ? ''
                  : ` (${draft.cardType})`}
              </option>
              {activeFace.cardType !== undefined &&
              !profile.cardTypes.includes(activeFace.cardType) ? (
                <option value={activeFace.cardType} disabled>
                  {activeFace.cardType} (not in profile)
                </option>
              ) : null}
              {profile.cardTypes.map((cardType) => (
                <option key={cardType} value={cardType}>
                  {cardType}
                </option>
              ))}
            </select>
            <p className="form-hint">
              Transformed faces can use a different type, which changes the
              fields shown below.
            </p>
          </div>

          <div className="form-field">
            <span className="form-field__label">Face subtypes</span>
            <div className="toggle-chips">
              {profile.subtypes.map((subtype) => {
                const active = effectiveFaceSubtypes.includes(subtype);
                return (
                  <button
                    key={subtype}
                    type="button"
                    className={`toggle-chip${active ? ' toggle-chip--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleFaceSubtype(subtype)}
                  >
                    {subtype}
                  </button>
                );
              })}

              {orphanedFaceSubtypes.map((subtype) => (
                <button
                  key={subtype}
                  type="button"
                  className="toggle-chip toggle-chip--warning"
                  onClick={() => toggleFaceSubtype(subtype)}
                >
                  Remove “{subtype}”
                </button>
              ))}

              {activeFace.subtypes === undefined ? null : (
                <button
                  type="button"
                  className="toggle-chip toggle-chip--secondary"
                  onClick={() => updateFace({ subtypes: undefined })}
                >
                  Use card subtypes
                </button>
              )}
            </div>
            <p className="form-hint">
              {activeFace.subtypes === undefined
                ? 'Inherited from the card. Changing a subtype creates a face override.'
                : 'This face overrides the card subtypes.'}
            </p>
          </div>

          <div className="form-field">
            <span className="form-field__label">Subtypes</span>
            <div className="toggle-chips">
              {profile.subtypes.map((subtype) => {
                const active = draft.subtypes.includes(subtype);
                return (
                  <button
                    key={subtype}
                    type="button"
                    className={`toggle-chip${active ? ' toggle-chip--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleSubtype(subtype)}
                  >
                    {subtype}
                  </button>
                );
              })}

              {orphanedSubtypes.map((subtype) => (
                <button
                  key={subtype}
                  type="button"
                  className="toggle-chip toggle-chip--warning"
                  onClick={() => toggleSubtype(subtype)}
                >
                  Remove “{subtype}”
                </button>
              ))}
            </div>
            {profile.subtypes.length === 0 ? (
              <p className="form-hint">
                No subtypes are defined by the current profile.
              </p>
            ) : null}
          </div>

          <TagListEditor
            label="Tags"
            description="Free-form tags used for library filtering."
            values={draft.tags}
            placeholder="Add a tag"
            onChange={(tags) =>
              setDraft((current) => ({ ...current, tags }))
            }
          />
              </section>
            ) : null}

            {activeSection === 'rules' ? (
              <section
                className="card-editor__section"
                id="card-editor-panel-rules"
                role="tabpanel"
                aria-labelledby="card-editor-tab-rules"
              >
                <div className="profile-editor__section-header">
                  <div>
                    <p className="eyebrow">Rules</p>
                    <h4>Face text</h4>
                    <p>
                      Rules and flavor text for the active face. Face changes
                      preserve unsaved text.
                    </p>
                  </div>
                </div>

                <div className="card-editor__text-grid">
                  <div className="form-field">
                    <label htmlFor={rulesId}>Rules text</label>
                    <textarea
                      id={rulesId}
                      className="text-area"
                      rows={8}
                      value={activeFace.rulesText}
                      onChange={(event) =>
                        updateFace({ rulesText: event.target.value })
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={flavorId}>Flavor text</label>
                    <textarea
                      id={flavorId}
                      className="text-area"
                      rows={8}
                      value={activeFace.flavorText ?? ''}
                      onChange={(event) =>
                        updateFace({
                          flavorText:
                            event.target.value === ''
                              ? undefined
                              : event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === 'stats' ? (
              <>
                <section
                  className="card-editor__section"
                  id="card-editor-panel-stats"
                  role="tabpanel"
                  aria-labelledby="card-editor-tab-stats"
                >
                  <div className="profile-editor__section-header">
                    <div>
                      <p className="eyebrow">Stats</p>
                      <h4>Root fields</h4>
                      <p>
                        Values stored once on the card record, scoped to the
                        card-level type rather than the active face.
                      </p>
                    </div>
                  </div>

          {rootFields.length === 0 ? (
            <p className="profile-editor__empty">
              No root-targeted fields are defined by the profile.
            </p>
          ) : (
            <div className="card-editor__grid">
              {rootFields.map((fieldState) => (
                <CardFieldControl
                  key={fieldState.definition.key}
                  state={fieldState}
                  onChange={(value) =>
                    updateAttribute(
                      'root',
                      fieldState.definition.key,
                      value,
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>

                <section className="card-editor__section card-editor__section--nested">
                  <div className="profile-editor__section-header">
                    <div>
                      <p className="eyebrow">Stats</p>
                      <h4>Face fields</h4>
                      <p>
                        Values stored on the active card face, using the
                        effective type “{effectiveFaceType || 'unset'}”.
                      </p>
                    </div>
                  </div>

                  {faceFields.length === 0 ? (
            <p className="profile-editor__empty">
              No face-targeted fields are defined by the profile.
            </p>
          ) : (
            <div className="card-editor__grid">
              {faceFields.map((fieldState) => (
                <CardFieldControl
                  key={`${activeFace.faceId}-${fieldState.definition.key}`}
                  state={fieldState}
                  onChange={(value) =>
                    updateAttribute(
                      'face',
                      fieldState.definition.key,
                      value,
                    )
                  }
                />
              ))}
            </div>
                  )}
                </section>
              </>
            ) : null}

            {activeSection === 'artwork' ? (
              <section
                className="card-editor__section"
                id="card-editor-panel-artwork"
                role="tabpanel"
                aria-labelledby="card-editor-tab-artwork"
              >
                <div className="profile-editor__section-header">
                  <div>
                    <p className="eyebrow">Artwork</p>
                    <h4>Face images</h4>
                    <p>
                      The art-box image feeds the generated template. A
                      full-card image replaces the generated preview entirely.
                    </p>
                  </div>
                </div>

                <div className="artwork-stack">
                  <ArtworkPicker
                    assets={assets}
                    selectedAssetId={activeFace.artAssetId}
                    disabled={saving}
                    label="Art box image"
                    emptyOptionLabel="No art-box image"
                    emptyLabel="No art-box image selected."
                    altLabel="Selected art-box image"
                    hint="Used inside the generated template layout. Images are hashed with SHA-256 before storage."
                    onSelect={(assetId) =>
                      updateFace({ artAssetId: assetId })
                    }
                    onImport={onImportArtwork}
                  />
                  <ArtworkPicker
                    assets={assets}
                    selectedAssetId={activeFace.fullCardAssetId ?? null}
                    disabled={saving}
                    label="Full-card image"
                    emptyOptionLabel="No full-card image"
                    emptyLabel="No full-card image. The generated preview is shown."
                    altLabel="Selected full-card image"
                    hint="A scan or export of the finished card. When present, it replaces the generated preview in browsing and detail views."
                    onSelect={(assetId) =>
                      updateFace({ fullCardAssetId: assetId })
                    }
                    onImport={onImportArtwork}
                  />
                </div>
              </section>
            ) : null}

        {reconciliation.orphaned.length === 0 ? null : (
          <section className="card-editor__section card-editor__orphaned">
            <div className="profile-editor__section-header">
              <div>
                <p className="eyebrow">Preserved values</p>
                <h4>Values without a current field definition</h4>
                <p>
                  These values are kept so profile changes never silently
                  discard card data. Remove them explicitly when ready.
                </p>
              </div>
            </div>

            <ul className="orphaned-values">
              {reconciliation.orphaned.map((attribute) => (
                <li
                  key={`${attribute.target}-${attribute.faceId ?? 'root'}-${attribute.key}`}
                >
                  <span>
                    <code>{attribute.key}</code> ({attribute.target}
                    {attribute.faceId === undefined
                      ? ''
                      : ` · ${attribute.faceId}`}
                    ) = {formatFieldValue(attribute.value)}
                  </span>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() =>
                      updateAttribute(
                        attribute.target,
                        attribute.key,
                        undefined,
                        attribute.faceId ?? activeFace.faceId,
                      )
                    }
                  >
                    Remove value
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

          </div>

          <aside className="card-editor__aside">
            <div className="card-editor__summary">
              <div className="card-editor__summary-head">
                <div>
                  <p className="eyebrow">Validation</p>
                  <h4>Save readiness</h4>
                </div>
                <span
                  className={`pill ${canSave ? 'pill--local' : 'pill--draft'}`}
                >
                  {canSave ? 'Ready' : `${validationIssues.length} issue${validationIssues.length === 1 ? '' : 's'}`}
                </span>
              </div>

              {validationIssues.length === 0 ? (
                <p className="form-hint">
                  No blocking issues. All required fields for the effective
                  card type are present.
                </p>
              ) : (
                <div
                  className="validation-banner validation-banner--compact"
                  role="status"
                  aria-live="polite"
                >
                  <p className="validation-banner__title">
                    Fix these before saving
                  </p>
                  <ul className="card-editor__issue-list">
                    {validationIssues.map((issue, index) => {
                      const section = sectionForIssue(issue.path);

                      return (
                        <li key={`${issue.path}-${issue.code}-${index}`}>
                          <span>{issue.message}</span>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => setActiveSection(section)}
                          >
                            Go to {sectionLabel(section)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="card-editor__summary-preview">
              <div className="card-editor__summary-preview-head">
                <p className="eyebrow">Live preview</p>
                <button
                  type="button"
                  className="button button--ghost"
                  aria-pressed={showLivePreview}
                  onClick={() => setShowLivePreview((current) => !current)}
                >
                  {showLivePreview ? 'Hide preview' : 'Show preview'}
                </button>
              </div>
              {showLivePreview ? (
                <CardPreview
                  card={draft}
                  profile={profile}
                  assets={assets}
                  template={activeTemplate}
                  faceId={activeFace.faceId}
                  compact
                />
              ) : (
                <p className="form-hint">
                  The live preview is hidden. Show it when you want to inspect
                  the card layout.
                </p>
              )}
            </div>
          </aside>
        </div>
      </fieldset>

      <div className="card-editor__footer">
        <button
          type="button"
          className="button button--ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={saving || !canSave}
        >
          {saving
            ? 'Saving…'
            : initialCard === null
              ? 'Create card'
              : 'Save card'}
        </button>
      </div>
    </form>
  );
}
