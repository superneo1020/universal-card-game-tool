import { useId, useMemo, useState } from 'react';

import { getSection } from '../../app/navigation';
import { filterCards } from '../../cards/cardModel';
import { createPackDraft } from '../../project/projectModel';
import type { CardTemplate } from '../../types/Card';
import type { CardRecord } from '../../types/CardRecord';
import type { CardPack } from '../../types/Collection';
import type { GameProfile } from '../../types/Game';
import type {
  AssetReference,
  ProjectManifest,
} from '../../types/ProjectManifest';
import type { ValidationIssue } from '../../utils/validation';
import { CardTile, MissingCardTile } from '../cards/CardTile';
import { EmptyState } from '../EmptyState';
import { SectionIcon } from '../SectionIcon';

const PACK_ICON_PATHS = getSection('packs').iconPaths;

interface PackLibraryProps {
  readonly project: ProjectManifest;
  readonly profile: GameProfile;
  readonly assets: readonly AssetReference[];
  readonly templates: readonly CardTemplate[];
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly onSave: (pack: CardPack) => Promise<boolean>;
  readonly onDelete: (packId: string) => Promise<boolean>;
}

type EditorState =
  | { readonly mode: 'new' }
  | { readonly mode: 'edit'; readonly packId: string };

function summarizeIssues(issues: readonly ValidationIssue[]): string {
  const preview = issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(' ');

  return issues.length > 3
    ? `${preview} (+${issues.length - 3} more)`
    : preview;
}

interface PackEditorProps {
  readonly initialPack: CardPack | null;
  readonly profile: GameProfile;
  readonly cards: readonly CardRecord[];
  readonly assets: readonly AssetReference[];
  readonly templates: readonly CardTemplate[];
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly onSave: (pack: CardPack) => Promise<boolean>;
  readonly onCancel: () => void;
}

function PackEditor({
  initialPack,
  profile,
  cards,
  assets,
  templates,
  saving,
  saveErrorMessage,
  saveIssues,
  onSave,
  onCancel,
}: PackEditorProps) {
  const nameId = useId();
  const descriptionId = useId();
  const releaseDateId = useId();
  const searchId = useId();
  const typeFilterId = useId();
  const [draft, setDraft] = useState<CardPack>(() =>
    initialPack === null
      ? createPackDraft()
      : structuredClone(initialPack),
  );
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const cardTypes = useMemo(
    () => [...new Set(cards.map((card) => card.cardType).filter(Boolean))].sort(),
    [cards],
  );

  const visibleCards = useMemo(
    () =>
      filterCards(cards, query, null).filter(
        (card) => typeFilter === '' || card.cardType === typeFilter,
      ),
    [cards, query, typeFilter],
  );
  const templateFor = (card: CardRecord) =>
    templates.find((template) => template.id === card.templateId) ?? null;
  const nameValid = draft.name.trim().length > 0;

  function toggleCard(cardId: string) {
    setDraft((current) => ({
      ...current,
      cardIds: current.cardIds.includes(cardId)
        ? current.cardIds.filter((id) => id !== cardId)
        : [...current.cardIds, cardId],
    }));
  }

  function submit() {
    if (!nameValid) {
      return;
    }

    const releaseDate = draft.releaseDate?.trim();

    void onSave({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      releaseDate:
        releaseDate === undefined || releaseDate.length === 0
          ? undefined
          : releaseDate,
    });
  }

  return (
    <div className="collection-editor">
      <div className="collection-editor__heading">
        <div>
          <p className="eyebrow">{initialPack === null ? 'New pack' : 'Edit pack'}</p>
          <h3>{initialPack === null ? 'Create a curated pack' : draft.name}</h3>
        </div>
        <span className="chip chip--muted">{draft.cardIds.length} card{draft.cardIds.length === 1 ? '' : 's'}</span>
      </div>

      {saveErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">{saveErrorMessage}</p>
          {saveIssues.length === 0 ? null : (
            <p>{summarizeIssues(saveIssues)}</p>
          )}
        </div>
      )}

      <div className="form-field">
        <label htmlFor={nameId}>Pack name</label>
        <input
          id={nameId}
          className="text-input"
          value={draft.name}
          placeholder="e.g. Starter Set Release"
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />
      </div>

      <div className="form-field">
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          className="text-area"
          rows={3}
          value={draft.description}
          placeholder="What is this release for?"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
        />
      </div>

      <div className="form-field">
        <label htmlFor={releaseDateId}>Release date</label>
        <input
          id={releaseDateId}
          className="text-input"
          type="date"
          value={draft.releaseDate ?? ''}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              releaseDate:
                event.target.value === '' ? undefined : event.target.value,
            }))
          }
        />
      </div>

      <div className="card-picker__filters">
        <div className="form-field">
          <label htmlFor={searchId}>Find cards</label>
          <input
            id={searchId}
            className="text-input"
            type="search"
            value={query}
            placeholder="Search the card library"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={typeFilterId}>Filter by type</label>
          <select
            id={typeFilterId}
            className="select-input"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="">All types</option>
            {cardTypes.map((cardType) => (
              <option key={cardType} value={cardType}>
                {cardType}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="collection-note">
          No cards exist yet. Create cards first, then curate this pack.
        </p>
      ) : visibleCards.length === 0 ? (
        <p className="collection-note">No cards match this search.</p>
      ) : (
        <div className="card-choice-grid" role="group" aria-label="Cards in this pack">
          {visibleCards.map((card) => {
            const checked = draft.cardIds.includes(card.id);

            return (
              <CardTile
                key={card.id}
                card={card}
                profile={profile}
                assets={assets}
                template={templateFor(card)}
                selected={checked}
                onSelect={() => toggleCard(card.id)}
              />
            );
          })}
        </div>
      )}

      {draft.cardIds.length === 0 ? (
        <p className="collection-note">
          This pack has no cards yet. Empty packs are allowed, but they will not
          be useful as a release.
        </p>
      ) : null}

      <div className="collection-editor__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={!nameValid || saving}
        >
          {saving ? 'Saving…' : 'Save pack'}
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Pack workspace: curated card sets with explicit card membership. This is a
 * static collection model; randomized boosters remain out of scope.
 */
export function PackLibrary({
  project,
  profile,
  assets,
  templates,
  saving,
  saveErrorMessage,
  saveIssues,
  onSave,
  onDelete,
}: PackLibraryProps) {
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [detailQuery, setDetailQuery] = useState('');
  const detailSearchId = useId();

  const packs = project.packs;
  const selectedPack =
    packs.find((pack) => pack.id === selectedPackId) ?? packs[0] ?? null;
  const editorPack =
    editor?.mode === 'edit'
      ? (packs.find((pack) => pack.id === editor.packId) ?? null)
      : null;
  const isEditorOpen =
    editor !== null && (editor.mode === 'new' || editorPack !== null);
  const cardNames = new Map(
    project.cards.map((card) => [
      card.id,
      card.name.trim().length === 0 ? 'Untitled card' : card.name,
    ]),
  );
  const cardsById = new Map(project.cards.map((card) => [card.id, card]));
  const templateFor = (card: CardRecord) =>
    templates.find((template) => template.id === card.templateId) ?? null;
  const normalizedDetailQuery = detailQuery.trim().toLowerCase();
  const visiblePackCardIds =
    selectedPack === null
      ? []
      : normalizedDetailQuery.length === 0
        ? selectedPack.cardIds
        : selectedPack.cardIds.filter((cardId) => {
            const card = cardsById.get(cardId);
            if (card === undefined) {
              return cardId.toLowerCase().includes(normalizedDetailQuery);
            }

            return [
              card.name,
              card.cardType,
              ...card.subtypes,
              ...card.tags,
            ].some((value) =>
              value.toLowerCase().includes(normalizedDetailQuery),
            );
          });

  async function handleSave(pack: CardPack) {
    const saved = await onSave(pack);

    if (saved) {
      setSelectedPackId(pack.id);
      setEditor(null);
      setPendingDeleteId(null);
    }

    return saved;
  }

  async function handleDelete(packId: string) {
    const deleted = await onDelete(packId);

    if (deleted) {
      setPendingDeleteId(null);
      setSelectedPackId(null);
      setEditor(null);
    }
  }

  if (isEditorOpen) {
    return (
      <PackEditor
        key={editor?.mode === 'new' ? 'new' : (editorPack?.id ?? 'none')}
        initialPack={editor?.mode === 'edit' ? editorPack : null}
        profile={profile}
        cards={project.cards}
        assets={assets}
        templates={templates}
        saving={saving}
        saveErrorMessage={saveErrorMessage}
        saveIssues={saveIssues}
        onSave={handleSave}
        onCancel={() => setEditor(null)}
      />
    );
  }

  if (packs.length === 0) {
    return (
      <EmptyState
        icon={<SectionIcon paths={PACK_ICON_PATHS} />}
        title="No packs curated yet"
        description="Packs are manually curated card sets for starters and releases. Cards can belong to multiple packs."
        actionLabel="Create pack"
        onAction={() => setEditor({ mode: 'new' })}
      />
    );
  }

  return (
    <div className="card-library">
      {saveErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">{saveErrorMessage}</p>
          {saveIssues.length === 0 ? null : (
            <p>{summarizeIssues(saveIssues)}</p>
          )}
        </div>
      )}

      <div className="card-library__toolbar">
        <div className="card-library__toolbar-meta">
          <span className="card-library__count">
            {packs.length} pack{packs.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setEditor({ mode: 'new' })}
            disabled={saving}
          >
            New pack
          </button>
        </div>
      </div>

      <div className="card-library__layout">
        <div className="card-library__list-panel">
          <ul className="card-list">
            {packs.map((pack) => {
              const active = selectedPack?.id === pack.id;

              return (
                <li key={pack.id}>
                  <button
                    type="button"
                    className={`card-list-item${active ? ' card-list-item--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedPackId(pack.id);
                      setPendingDeleteId(null);
                    }}
                  >
                    <span className="card-list-item__name">
                      {pack.name.trim().length === 0
                        ? 'Untitled pack'
                        : pack.name}
                    </span>
                    <span className="card-list-item__meta">
                      {pack.cardIds.length} card
                      {pack.cardIds.length === 1 ? '' : 's'}
                      {pack.releaseDate === undefined
                        ? ''
                        : ` · ${pack.releaseDate}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card-library__detail">
          {selectedPack === null ? (
            <div className="card-library__empty-filter">
              <p>Select a pack to inspect it.</p>
            </div>
          ) : (
            <article className="collection-summary">
              <p className="eyebrow">Pack</p>
              <h3>
                {selectedPack.name.trim().length === 0
                  ? 'Untitled pack'
                  : selectedPack.name}
              </h3>
              <p>
                {selectedPack.description.trim().length === 0
                  ? 'No description yet.'
                  : selectedPack.description}
              </p>
              <dl className="collection-meta">
                <div>
                  <dt>Cards</dt>
                  <dd>{selectedPack.cardIds.length}</dd>
                </div>
                <div>
                  <dt>Release</dt>
                  <dd>{selectedPack.releaseDate ?? 'Unset'}</dd>
                </div>
              </dl>
              {selectedPack.cardIds.length === 0 ? (
                <p className="collection-note">No cards in this pack yet.</p>
              ) : (
                <>
                  <div className="collection-view-controls">
                    <span className="collection-view-controls__label">
                      View
                    </span>
                    <button
                      type="button"
                      className={`filter-chip${viewMode === 'grid' ? ' filter-chip--active' : ''}`}
                      aria-pressed={viewMode === 'grid'}
                      onClick={() => setViewMode('grid')}
                    >
                      Grid
                    </button>
                    <button
                      type="button"
                      className={`filter-chip${viewMode === 'list' ? ' filter-chip--active' : ''}`}
                      aria-pressed={viewMode === 'list'}
                      onClick={() => setViewMode('list')}
                    >
                      List
                    </button>
                  </div>

                  <div className="form-field collection-detail-search">
                    <label htmlFor={detailSearchId}>Find in pack</label>
                    <input
                      id={detailSearchId}
                      className="text-input"
                      type="search"
                      value={detailQuery}
                      placeholder="Search this pack"
                      onChange={(event) => setDetailQuery(event.target.value)}
                    />
                  </div>

                  {visiblePackCardIds.length === 0 ? (
                    <p className="collection-note">
                      No cards match this pack search.
                    </p>
                  ) : viewMode === 'grid' ? (
                    <div className="card-tile-grid">
                      {visiblePackCardIds.map((cardId) => {
                        const card = cardsById.get(cardId);

                        return card === undefined ? (
                          <MissingCardTile key={cardId} cardId={cardId} />
                        ) : (
                          <CardTile
                            key={cardId}
                            card={card}
                            profile={profile}
                            assets={assets}
                            template={templateFor(card)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <ul className="collection-card-list">
                      {visiblePackCardIds.map((cardId) => (
                        <li key={cardId}>
                          {cardNames.get(cardId) ?? cardId}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {pendingDeleteId === selectedPack.id ? (
                <div className="card-delete-confirm" role="alert">
                  <p>
                    Delete “{selectedPack.name || 'Untitled pack'}”? This removes
                    the pack but keeps its cards.
                  </p>
                  <div className="card-delete-confirm__actions">
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={saving}
                      onClick={() => {
                        void handleDelete(selectedPack.id);
                      }}
                    >
                      Delete pack
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setPendingDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card-preview__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() =>
                      setEditor({
                        mode: 'edit',
                        packId: selectedPack.id,
                      })
                    }
                    disabled={saving}
                  >
                    Edit pack
                  </button>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => setPendingDeleteId(selectedPack.id)}
                    disabled={saving}
                  >
                    Delete
                  </button>
                </div>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
