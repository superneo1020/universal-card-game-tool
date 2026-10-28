import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { getSection } from '../../app/navigation';
import {
  collectCardTags,
  filterCards,
  reconcileCard,
} from '../../cards/cardModel';
import type { UseCardLibraryResult } from '../../hooks/useCardLibrary';
import type { ArtworkImportResult } from '../../hooks/useProject';
import type { CardTemplate } from '../../types/Card';
import type { CardRecord } from '../../types/CardRecord';
import type { CardPack } from '../../types/Collection';
import type { GameProfile } from '../../types/Game';
import type { AssetReference } from '../../types/ProjectManifest';
import type { ValidationIssue } from '../../utils/validation';
import { EmptyState } from '../EmptyState';
import { SectionIcon } from '../SectionIcon';
import { CardEditor } from './CardEditor';
import { CardPreview } from './CardPreview';
import { CardTile } from './CardTile';

const CARD_ICON_PATHS = getSection('cards').iconPaths;

function summarizeIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) {
    return 'The stored card library could not be validated.';
  }

  const preview = issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(' ');

  return issues.length > 3
    ? `${preview} (+${issues.length - 3} more)`
    : preview;
}

interface CardLibraryProps {
  readonly profile: GameProfile;
  readonly library: UseCardLibraryResult;
  readonly assets: readonly AssetReference[];
  readonly templates: readonly CardTemplate[];
  readonly packs: readonly CardPack[];
  readonly onImportArtwork: (
    files: readonly File[],
  ) => Promise<ArtworkImportResult>;
}

type EditorState = { readonly mode: 'new' } | {
  readonly mode: 'edit';
  readonly cardId: string;
};

/**
 * Card library workspace: search, tag filters, list, preview, and profile-
 * driven editor. Card data is owned by the library hook; components only
 * receive and return records.
 */
export function CardLibrary({
  profile,
  library,
  assets,
  templates,
  packs,
  onImportArtwork,
}: CardLibraryProps) {
  const searchId = useId();
  const typeFilterId = useId();
  const subtypeFilterId = useId();
  const packFilterId = useId();
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState('');
  const [selectedSubtype, setSelectedSubtype] = useState('');
  const [selectedPackId, setSelectedPackId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery');

  const cards = library.state.cards;
  const tags = useMemo(() => collectCardTags(cards), [cards]);
  const cardTypes = useMemo(
    () => [...new Set(cards.map((card) => card.cardType).filter(Boolean))].sort(),
    [cards],
  );
  const subtypes = useMemo(
    () =>
      [...new Set(cards.flatMap((card) => card.subtypes).filter(Boolean))].sort(),
    [cards],
  );
  const activeTag =
    selectedTag !== null && tags.includes(selectedTag) ? selectedTag : null;
  const filteredCards = useMemo(
    () =>
      filterCards(cards, query, activeTag).filter(
        (card) =>
          (selectedType === '' || card.cardType === selectedType) &&
          (selectedSubtype === '' || card.subtypes.includes(selectedSubtype)) &&
          (selectedPackId === '' ||
            packs.some(
              (pack) =>
                pack.id === selectedPackId && pack.cardIds.includes(card.id),
            )),
      ),
    [cards, query, activeTag, selectedType, selectedSubtype, selectedPackId, packs],
  );
  const selectedCard =
    filteredCards.find((card) => card.id === selectedCardId) ?? null;
  const hasActiveFilters =
    query.trim().length > 0 ||
    activeTag !== null ||
    selectedType !== '' ||
    selectedSubtype !== '' ||
    selectedPackId !== '';

  const editorCard =
    editor?.mode === 'edit'
      ? (cards.find((card) => card.id === editor.cardId) ?? null)
      : null;
  const isEditorOpen =
    editor !== null && (editor.mode === 'new' || editorCard !== null);
  const isDetailOpen = isEditorOpen || selectedCard !== null;

  function startNewCard() {
    setPendingDeleteId(null);
    setEditor({ mode: 'new' });
  }

  function startEditing(card: CardRecord) {
    setPendingDeleteId(null);
    setEditor({ mode: 'edit', cardId: card.id });
  }

  function clearFilters() {
    setQuery('');
    setSelectedTag(null);
    setSelectedType('');
    setSelectedSubtype('');
    setSelectedPackId('');
  }

  function closeDetail() {
    setSelectedCardId(null);
    setEditor(null);
    setPendingDeleteId(null);
  }

  useEffect(() => {
    if (!isDetailOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeDetail();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDetailOpen]);

  async function handleSaveCard(card: CardRecord) {
    const saved = await library.saveCard(card);

    if (saved) {
      setSelectedCardId(card.id);
      setEditor(null);
      setPendingDeleteId(null);
      setQuery('');
      setSelectedTag(null);
    }
  }

  async function handleDeleteCard(cardId: string) {
    const deleted = await library.deleteCard(cardId);

    if (deleted) {
      setPendingDeleteId(null);
      setSelectedCardId(null);
      setEditor(null);
    }
  }

  if (library.state.status === 'loading') {
    return (
      <div className="profile-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Loading the card library…</p>
      </div>
    );
  }

  if (library.state.status === 'error') {
    const hasInvalidStoredLibrary = library.state.loadIssues.length > 0;

    return (
      <EmptyState
        icon={<SectionIcon paths={CARD_ICON_PATHS} />}
        title={
          hasInvalidStoredLibrary
            ? 'Stored card library is invalid'
            : 'Could not load the card library'
        }
        description={
          hasInvalidStoredLibrary
            ? summarizeIssues(library.state.loadIssues)
            : (library.state.loadErrorMessage ??
              'The local storage layer returned an unknown error.')
        }
        actionLabel={
          hasInvalidStoredLibrary ? 'Reset card library' : 'Retry loading'
        }
        onAction={
          hasInvalidStoredLibrary
            ? () => {
                void library.clearLibrary();
              }
            : library.reload
        }
        actionNote={
          hasInvalidStoredLibrary
            ? 'This removes the saved cards for this profile.'
            : undefined
        }
      />
    );
  }

  if (cards.length === 0) {
    if (isEditorOpen) {
      return (
        <CardEditor
          key="new"
          profile={profile}
          templates={templates}
          assets={assets}
          initialCard={null}
          saving={library.state.saving}
          onSave={(card) => {
            void handleSaveCard(card);
          }}
          onImportArtwork={onImportArtwork}
          onCancel={() => setEditor(null)}
        />
      );
    }

    return (
      <EmptyState
        icon={<SectionIcon paths={CARD_ICON_PATHS} />}
        title="Your card library is empty"
        description="Create the first card from your saved profile. Every field below the core properties is generated from that schema."
        actionLabel="Create first card"
        onAction={startNewCard}
      />
    );
  }

  return (
    <div className="card-library">
      <div className="card-library__toolbar">
        <div className="form-field card-library__search">
          <label htmlFor={searchId}>Search cards</label>
          <input
            id={searchId}
            className="text-input"
            type="search"
            value={query}
            placeholder="Search names, types, subtypes, or tags"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="card-library__toolbar-meta">
          <span className="card-library__count" aria-live="polite">
            {filteredCards.length} of {cards.length} card
            {cards.length === 1 ? '' : 's'}
          </span>
          <div className="collection-view-controls" role="group" aria-label="Card view">
            <button
              type="button"
              className={`filter-chip${viewMode === 'gallery' ? ' filter-chip--active' : ''}`}
              aria-pressed={viewMode === 'gallery'}
              onClick={() => setViewMode('gallery')}
            >
              Gallery
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
          <button
            type="button"
            className="button button--primary"
            onClick={startNewCard}
            disabled={library.state.saving}
          >
            New card
          </button>
        </div>
      </div>

      <div className="card-library__facets" role="group" aria-label="Card filters">
        <div className="form-field">
          <label htmlFor={typeFilterId}>Type</label>
          <select
            id={typeFilterId}
            className="select-input"
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value)}
          >
            <option value="">All types</option>
            {cardTypes.map((cardType) => (
              <option key={cardType} value={cardType}>
                {cardType}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={subtypeFilterId}>Subtype</label>
          <select
            id={subtypeFilterId}
            className="select-input"
            value={selectedSubtype}
            onChange={(event) => setSelectedSubtype(event.target.value)}
          >
            <option value="">All subtypes</option>
            {subtypes.map((subtype) => (
              <option key={subtype} value={subtype}>
                {subtype}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={packFilterId}>Pack</label>
          <select
            id={packFilterId}
            className="select-input"
            value={selectedPackId}
            onChange={(event) => setSelectedPackId(event.target.value)}
          >
            <option value="">All packs</option>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name.trim().length === 0 ? 'Untitled pack' : pack.name}
              </option>
            ))}
          </select>
        </div>
        {hasActiveFilters ? (
          <button
            type="button"
            className="button button--ghost card-library__clear-filters"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {tags.length === 0 ? null : (
        <div className="card-filter-bar" role="group" aria-label="Filter by tag">
          <button
            type="button"
            className={`filter-chip${activeTag === null ? ' filter-chip--active' : ''}`}
            aria-pressed={activeTag === null}
            onClick={() => setSelectedTag(null)}
          >
            All tags
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`filter-chip${activeTag === tag ? ' filter-chip--active' : ''}`}
              aria-pressed={activeTag === tag}
              onClick={() => setSelectedTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {library.state.saveErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">Could not save card changes</p>
          <p>{library.state.saveErrorMessage}</p>
        </div>
      )}

      {filteredCards.length === 0 ? (
        <div className="card-library__empty-filter">
          <p>No cards match your current search and filters.</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
      ) : viewMode === 'gallery' ? (
        <div className="card-pool" role="group" aria-label="Card gallery">
          {filteredCards.map((card) => {
            const reconciliation = reconcileCard(card, profile);
            const needsAttention =
              reconciliation.issues.length > 0 ||
              reconciliation.orphaned.length > 0;
            const active = selectedCard?.id === card.id;
            const template =
              templates.find((item) => item.id === card.templateId) ?? null;

            return (
              <div key={card.id} className="card-tile-entry">
                <CardTile
                  card={card}
                  profile={profile}
                  assets={assets}
                  template={template}
                  selected={active}
                  onSelect={() => {
                    setSelectedCardId(card.id);
                    setEditor(null);
                    setPendingDeleteId(null);
                  }}
                />
                {needsAttention ? (
                  <span className="card-tile-entry__warning">
                    Needs attention
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="card-list card-library__list-view" aria-label="Card list">
          {filteredCards.map((card) => {
            const reconciliation = reconcileCard(card, profile);
            const needsAttention =
              reconciliation.issues.length > 0 ||
              reconciliation.orphaned.length > 0;
            const active = selectedCard?.id === card.id;

            return (
              <li key={card.id}>
                <button
                  type="button"
                  className={`card-list-item${active ? ' card-list-item--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedCardId(card.id);
                    setEditor(null);
                    setPendingDeleteId(null);
                  }}
                >
                  <span className="card-list-item__name">
                    {card.name.trim().length === 0 ? 'Untitled card' : card.name}
                  </span>
                  <span className="card-list-item__meta">
                    {card.cardType || 'No card type'}
                    {card.subtypes.length === 0
                      ? ''
                      : ` · ${card.subtypes.join(' / ')}`}
                  </span>
                  {card.tags.length === 0 ? null : (
                    <span className="card-list-item__tags">
                      {card.tags.map((tag) => (
                        <span className="chip chip--muted" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                  {needsAttention ? (
                    <span className="card-list-item__warning">
                      Needs attention
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {isDetailOpen
        ? createPortal(
            <div
              className="card-detail-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={
                isEditorOpen
                  ? editor?.mode === 'new'
                    ? 'Create card'
                    : 'Edit card'
                  : 'Card details'
              }
            >
          <button
            type="button"
            className="card-detail-overlay__backdrop"
            aria-label="Close card details"
            onClick={closeDetail}
          />
          <div className="card-detail-sheet">
            <div className="card-detail-sheet__header">
              <div>
                <p className="eyebrow">{isEditorOpen ? 'Card editor' : 'Card'}</p>
                <h3>
                  {isEditorOpen
                    ? editor?.mode === 'new'
                      ? 'New card'
                      : (editorCard?.name ?? 'Edit card')
                    : (selectedCard?.name ?? 'Card details')}
                </h3>
              </div>
              <button
                type="button"
                className="button button--ghost card-detail-sheet__close"
                onClick={closeDetail}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="card-detail-sheet__body">
              {isEditorOpen ? (
                <CardEditor
                  key={
                    editor?.mode === 'new'
                      ? 'new'
                      : (editorCard?.id ?? 'none')
                  }
                  profile={profile}
                  templates={templates}
                  assets={assets}
                  initialCard={editor?.mode === 'edit' ? editorCard : null}
                  saving={library.state.saving}
                  onSave={(card) => {
                    void handleSaveCard(card);
                  }}
                  onImportArtwork={onImportArtwork}
                  onCancel={closeDetail}
                />
              ) : selectedCard === null ? null : (
                <>
                  <CardPreview
                    key={selectedCard.id}
                    card={selectedCard}
                    profile={profile}
                    assets={assets}
                    template={
                      templates.find(
                        (template) => template.id === selectedCard.templateId,
                      ) ?? null
                    }
                  />

                  {pendingDeleteId === selectedCard.id ? (
                    <div className="card-delete-confirm" role="alert">
                      <p>
                        Delete “
                        {selectedCard.name.trim().length === 0
                          ? 'Untitled card'
                          : selectedCard.name}
                        ”? This cannot be undone.
                      </p>
                      <div className="card-delete-confirm__actions">
                        <button
                          type="button"
                          className="button button--danger"
                          disabled={library.state.saving}
                          onClick={() => {
                            void handleDeleteCard(selectedCard.id);
                          }}
                        >
                          Delete card
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
                        onClick={() => startEditing(selectedCard)}
                        disabled={library.state.saving}
                      >
                        Edit card
                      </button>
                      <button
                        type="button"
                        className="button button--danger-ghost"
                        onClick={() => setPendingDeleteId(selectedCard.id)}
                        disabled={library.state.saving}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
