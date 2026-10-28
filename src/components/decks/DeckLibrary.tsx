import { useId, useMemo, useState } from 'react';

import { getSection } from '../../app/navigation';
import { createDeckDraft } from '../../project/projectModel';
import type { CardTemplate } from '../../types/Card';
import type { CardRecord } from '../../types/CardRecord';
import type { Deck } from '../../types/Collection';
import type { GameProfile } from '../../types/Game';
import type { AssetReference } from '../../types/ProjectManifest';
import type { ValidationIssue } from '../../utils/validation';
import { CardTile, MissingCardTile } from '../cards/CardTile';
import { CardThumb } from '../cards/CardThumb';
import { EmptyState } from '../EmptyState';
import { SectionIcon } from '../SectionIcon';
import { TagListEditor } from '../TagListEditor';

const DECK_ICON_PATHS = getSection('decks').iconPaths;

interface DeckLibraryProps {
  readonly profile: GameProfile;
  readonly cards: readonly CardRecord[];
  readonly decks: readonly Deck[];
  readonly assets: readonly AssetReference[];
  readonly templates: readonly CardTemplate[];
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly onSave: (deck: Deck) => Promise<boolean>;
  readonly onDelete: (deckId: string) => Promise<boolean>;
}

type EditorState =
  | { readonly mode: 'new' }
  | { readonly mode: 'edit'; readonly deckId: string };

function summarizeIssues(issues: readonly ValidationIssue[]): string {
  const preview = issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(' ');

  return issues.length > 3
    ? `${preview} (+${issues.length - 3} more)`
    : preview;
}

function deckTotal(deck: Deck): number {
  return deck.entries.reduce((total, entry) => total + entry.count, 0);
}

function deckWarnings(
  deck: Deck,
  profile: GameProfile,
  cardNames: ReadonlyMap<string, string>,
): string[] {
  const warnings: string[] = [];
  const total = deckTotal(deck);

  if (deck.entries.length === 0) {
    warnings.push('This deck has no cards yet.');
  }

  if (total < profile.deckRules.minSize) {
    warnings.push(
      `Deck has ${total} card${total === 1 ? '' : 's'}; recommended minimum is ${profile.deckRules.minSize}.`,
    );
  }

  if (total > profile.deckRules.maxSize) {
    warnings.push(
      `Deck has ${total} card${total === 1 ? '' : 's'}; recommended maximum is ${profile.deckRules.maxSize}.`,
    );
  }

  deck.entries.forEach((entry) => {
    if (entry.count > profile.deckRules.maxCopiesPerCard) {
      warnings.push(
        `${cardNames.get(entry.cardId) ?? entry.cardId} has ${entry.count} copies; soft limit is ${profile.deckRules.maxCopiesPerCard}.`,
      );
    }
  });

  return warnings;
}

interface DeckEditorProps {
  readonly initialDeck: Deck | null;
  readonly profile: GameProfile;
  readonly cards: readonly CardRecord[];
  readonly assets: readonly AssetReference[];
  readonly templates: readonly CardTemplate[];
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly onSave: (deck: Deck) => Promise<boolean>;
  readonly onCancel: () => void;
}

function DeckEditor({
  initialDeck,
  profile,
  cards,
  assets,
  templates,
  saving,
  saveErrorMessage,
  saveIssues,
  onSave,
  onCancel,
}: DeckEditorProps) {
  const nameId = useId();
  const formatId = useId();
  const searchId = useId();
  const typeFilterId = useId();
  const [draft, setDraft] = useState<Deck>(() =>
    initialDeck === null
      ? createDeckDraft(profile.id)
      : structuredClone(initialDeck),
  );
  const [cardQuery, setCardQuery] = useState('');
  const [cardTypeFilter, setCardTypeFilter] = useState('');
  const cardTypes = useMemo(
    () => [...new Set(cards.map((card) => card.cardType).filter(Boolean))].sort(),
    [cards],
  );

  const cardNames = useMemo(
    () =>
      new Map(
        cards.map((card) => [
          card.id,
          card.name.trim().length === 0 ? 'Untitled card' : card.name,
        ]),
      ),
    [cards],
  );
  const availableCards = useMemo(
    () =>
      cards.filter(
        (card) =>
          !draft.entries.some((entry) => entry.cardId === card.id) &&
          (cardTypeFilter === '' || card.cardType === cardTypeFilter),
      ),
    [cards, draft.entries, cardTypeFilter],
  );
  const normalizedCardQuery = cardQuery.trim().toLowerCase();
  const filteredAvailableCards = useMemo(
    () =>
      normalizedCardQuery.length === 0
        ? availableCards
        : availableCards.filter((card) =>
            [
              card.name,
              card.cardType,
              ...card.subtypes,
              ...card.tags,
            ].some((value) =>
              value.toLowerCase().includes(normalizedCardQuery),
            ),
          ),
    [availableCards, normalizedCardQuery],
  );
  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );
  const templateFor = (card: CardRecord) =>
    templates.find((template) => template.id === card.templateId) ?? null;
  const warnings = deckWarnings(draft, profile, cardNames);
  const nameValid = draft.name.trim().length > 0;
  const formatValid = draft.format.trim().length > 0;

  function setEntryCount(cardId: string, count: number) {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.cardId === cardId ? { ...entry, count } : entry,
      ),
    }));
  }

  function removeEntry(cardId: string) {
    setDraft((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.cardId !== cardId),
    }));
  }

  function addCard(cardId: string) {
    setDraft((current) => ({
      ...current,
      entries: [...current.entries, { cardId, count: 1 }],
    }));
    setCardQuery('');
  }

  function submit() {
    if (!nameValid || !formatValid) {
      return;
    }

    void onSave({
      ...draft,
      name: draft.name.trim(),
      format: draft.format.trim(),
    });
  }

  return (
    <div className="collection-editor">
      <div className="collection-editor__heading">
        <div>
          <p className="eyebrow">
            {initialDeck === null ? 'New deck' : 'Edit deck'}
          </p>
          <h3>{initialDeck === null ? 'Assemble a deck' : draft.name}</h3>
        </div>
        <span className="chip chip--muted">
          {deckTotal(draft)} card{deckTotal(draft) === 1 ? '' : 's'}
        </span>
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
        <label htmlFor={nameId}>Deck name</label>
        <input
          id={nameId}
          className="text-input"
          value={draft.name}
          placeholder="e.g. Mono-red aggro"
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />
      </div>

      <div className="form-field">
        <label htmlFor={formatId}>Format</label>
        <input
          id={formatId}
          className="text-input"
          value={draft.format}
          placeholder="e.g. Standard"
          onChange={(event) =>
            setDraft((current) => ({ ...current, format: event.target.value }))
          }
        />
      </div>

      <TagListEditor
        label="Deck tags"
        description="Tags are organizational; deck quantities remain explicit entries."
        values={draft.tags}
        placeholder="Add a deck tag"
        onChange={(tags) =>
          setDraft((current) => ({ ...current, tags }))
        }
      />

      <div className="collection-subsection">
        <div className="collection-subsection__heading">
          <h4>Cards</h4>
          <span className="chip chip--muted">{draft.entries.length} unique</span>
        </div>

        {draft.entries.length === 0 ? (
          <p className="collection-note">No cards in this deck yet.</p>
        ) : (
          <ul className="entry-list">
            {draft.entries.map((entry) => {
              const card = cardsById.get(entry.cardId);

              return (
                <li className="entry-row" key={entry.cardId}>
                  <span className="entry-row__identity">
                    {card === undefined ? null : (
                      <CardThumb
                        card={card}
                        profile={profile}
                        assets={assets}
                        template={templateFor(card)}
                      />
                    )}
                    <span className="entry-row__name">
                      {cardNames.get(entry.cardId) ?? entry.cardId}
                    </span>
                  </span>
                  <label className="entry-row__count">
                    <span>Copies</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      step={1}
                      value={entry.count}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        setEntryCount(
                          entry.cardId,
                          Number.isInteger(parsed) && parsed >= 1 ? parsed : 1,
                        );
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => removeEntry(entry.cardId)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="card-picker">
          <div className="card-picker__filters">
            <div className="form-field">
              <label htmlFor={searchId}>Find cards to add</label>
              <input
                id={searchId}
                className="text-input"
                type="search"
                value={cardQuery}
                placeholder="Search the card library"
                onChange={(event) => setCardQuery(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor={typeFilterId}>Filter by type</label>
              <select
                id={typeFilterId}
                className="select-input"
                value={cardTypeFilter}
                onChange={(event) => setCardTypeFilter(event.target.value)}
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

          {availableCards.length === 0 ? (
            <p className="collection-note">
              All cards are already in this deck.
            </p>
          ) : filteredAvailableCards.length === 0 ? (
            <p className="collection-note">No cards match this search.</p>
          ) : (
            <div className="card-choice-grid" role="group" aria-label="Cards to add">
              {filteredAvailableCards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  profile={profile}
                  assets={assets}
                  template={templateFor(card)}
                  onSelect={() => addCard(card.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {warnings.length === 0 ? null : (
        <div className="soft-warning" role="status">
          <p className="soft-warning__title">Soft deck warnings</p>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p className="soft-warning__note">
            These are guidance only; saving is allowed.
          </p>
        </div>
      )}

      <div className="collection-editor__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={!nameValid || !formatValid || saving}
        >
          {saving ? 'Saving…' : 'Save deck'}
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

/** Deck workspace with explicit card quantities and soft rule warnings. */
export function DeckLibrary({
  profile,
  cards,
  decks,
  assets,
  templates,
  saving,
  saveErrorMessage,
  saveIssues,
  onSave,
  onDelete,
}: DeckLibraryProps) {
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [detailQuery, setDetailQuery] = useState('');
  const detailSearchId = useId();

  const selectedDeck =
    decks.find((deck) => deck.id === selectedDeckId) ?? decks[0] ?? null;
  const editorDeck =
    editor?.mode === 'edit'
      ? (decks.find((deck) => deck.id === editor.deckId) ?? null)
      : null;
  const isEditorOpen =
    editor !== null && (editor.mode === 'new' || editorDeck !== null);
  const cardNames = new Map(
    cards.map((card) => [
      card.id,
      card.name.trim().length === 0 ? 'Untitled card' : card.name,
    ]),
  );
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const templateFor = (card: CardRecord) =>
    templates.find((template) => template.id === card.templateId) ?? null;
  const normalizedDetailQuery = detailQuery.trim().toLowerCase();
  const visibleDeckEntries =
    selectedDeck === null
      ? []
      : normalizedDetailQuery.length === 0
        ? selectedDeck.entries
        : selectedDeck.entries.filter((entry) => {
            const card = cardsById.get(entry.cardId);
            if (card === undefined) {
              return entry.cardId.toLowerCase().includes(normalizedDetailQuery);
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

  async function handleSave(deck: Deck) {
    const saved = await onSave(deck);

    if (saved) {
      setSelectedDeckId(deck.id);
      setEditor(null);
      setPendingDeleteId(null);
    }

    return saved;
  }

  async function handleDelete(deckId: string) {
    const deleted = await onDelete(deckId);

    if (deleted) {
      setPendingDeleteId(null);
      setSelectedDeckId(null);
      setEditor(null);
    }
  }

  if (isEditorOpen) {
    return (
      <DeckEditor
        key={editor?.mode === 'new' ? 'new' : (editorDeck?.id ?? 'none')}
        initialDeck={editor?.mode === 'edit' ? editorDeck : null}
        profile={profile}
        cards={cards}
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

  if (decks.length === 0) {
    return (
      <EmptyState
        icon={<SectionIcon paths={DECK_ICON_PATHS} />}
        title="No decks assembled yet"
        description="Decklists reference cards in the library with explicit quantities. Deck-size and copy limits appear as soft warnings, never hard blocks."
        actionLabel="Create deck"
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
            {decks.length} deck{decks.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setEditor({ mode: 'new' })}
            disabled={saving}
          >
            New deck
          </button>
        </div>
      </div>

      <div className="card-library__layout">
        <div className="card-library__list-panel">
          <ul className="card-list">
            {decks.map((deck) => {
              const active = selectedDeck?.id === deck.id;

              return (
                <li key={deck.id}>
                  <button
                    type="button"
                    className={`card-list-item${active ? ' card-list-item--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedDeckId(deck.id);
                      setPendingDeleteId(null);
                    }}
                  >
                    <span className="card-list-item__name">
                      {deck.name.trim().length === 0
                        ? 'Untitled deck'
                        : deck.name}
                    </span>
                    <span className="card-list-item__meta">
                      {deck.format || 'No format'} · {deckTotal(deck)} card
                      {deckTotal(deck) === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card-library__detail">
          {selectedDeck === null ? (
            <div className="card-library__empty-filter">
              <p>Select a deck to inspect it.</p>
            </div>
          ) : (
            <article className="collection-summary">
              <p className="eyebrow">Deck</p>
              <h3>
                {selectedDeck.name.trim().length === 0
                  ? 'Untitled deck'
                  : selectedDeck.name}
              </h3>
              <dl className="collection-meta">
                <div>
                  <dt>Format</dt>
                  <dd>{selectedDeck.format || 'Unset'}</dd>
                </div>
                <div>
                  <dt>Cards</dt>
                  <dd>{deckTotal(selectedDeck)}</dd>
                </div>
                <div>
                  <dt>Unique</dt>
                  <dd>{selectedDeck.entries.length}</dd>
                </div>
              </dl>

              {selectedDeck.tags.length === 0 ? null : (
                <div className="card-preview__tags" aria-label="Deck tags">
                  {selectedDeck.tags.map((tag) => (
                    <span className="chip chip--muted" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {selectedDeck.entries.length === 0 ? (
                <p className="collection-note">No cards in this deck yet.</p>
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
                    <label htmlFor={detailSearchId}>Find in deck</label>
                    <input
                      id={detailSearchId}
                      className="text-input"
                      type="search"
                      value={detailQuery}
                      placeholder="Search this deck"
                      onChange={(event) => setDetailQuery(event.target.value)}
                    />
                  </div>

                  {visibleDeckEntries.length === 0 ? (
                    <p className="collection-note">
                      No cards match this deck search.
                    </p>
                  ) : viewMode === 'grid' ? (
                    <div className="card-tile-grid">
                      {visibleDeckEntries.map((entry) => {
                        const card = cardsById.get(entry.cardId);

                        return card === undefined ? (
                          <MissingCardTile
                            key={entry.cardId}
                            cardId={entry.cardId}
                            quantity={entry.count}
                          />
                        ) : (
                          <CardTile
                            key={entry.cardId}
                            card={card}
                            profile={profile}
                            assets={assets}
                            template={templateFor(card)}
                            quantity={entry.count}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <ul className="collection-card-list">
                      {visibleDeckEntries.map((entry) => (
                        <li key={entry.cardId}>
                          {cardNames.get(entry.cardId) ?? entry.cardId} ×{' '}
                          {entry.count}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {deckWarnings(selectedDeck, profile, cardNames).length === 0 ? null : (
                <div className="soft-warning" role="status">
                  <p className="soft-warning__title">Soft deck warnings</p>
                  <ul>
                    {deckWarnings(selectedDeck, profile, cardNames).map(
                      (warning) => (
                        <li key={warning}>{warning}</li>
                      ),
                    )}
                  </ul>
                </div>
              )}

              {pendingDeleteId === selectedDeck.id ? (
                <div className="card-delete-confirm" role="alert">
                  <p>
                    Delete “{selectedDeck.name || 'Untitled deck'}”? This removes
                    the deck but keeps its cards.
                  </p>
                  <div className="card-delete-confirm__actions">
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={saving}
                      onClick={() => {
                        void handleDelete(selectedDeck.id);
                      }}
                    >
                      Delete deck
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
                        deckId: selectedDeck.id,
                      })
                    }
                    disabled={saving}
                  >
                    Edit deck
                  </button>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => setPendingDeleteId(selectedDeck.id)}
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
