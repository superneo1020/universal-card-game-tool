import { useState } from 'react';

import {
  formatFieldValue,
  getCardFace,
  getCardFaceById,
  isPresentFieldValue,
  reconcileCard,
} from '../../cards/cardModel';
import { useVerifiedArtwork } from '../../hooks/useVerifiedArtwork';
import { DESIGN_TOKEN_CLASS_NAMES } from '../../templates/designTokens';
import type { CardTemplate, TemplateBlock } from '../../types/Card';
import type { CardRecord } from '../../types/CardRecord';
import type { GameProfile, StructuredFieldEntry } from '../../types/Game';
import type { AssetReference } from '../../types/ProjectManifest';
import { VerifiedArtworkImage } from './VerifiedArtworkImage';

interface CardPreviewProps {
  readonly card: CardRecord;
  readonly profile: GameProfile;
  readonly assets: readonly AssetReference[];
  readonly template: CardTemplate | null;
  /** Forces a specific face, including in compact previews. */
  readonly faceId?: string;
  /** Suppresses face tabs, warnings, and unclaimed fields for card tiles. */
  readonly compact?: boolean;
}

/**
 * Read-only, data-driven card preview. Rendering receives card/profile data as
 * props and never mutates the model.
 */
export function CardPreview({
  card,
  profile,
  assets,
  template,
  faceId,
  compact = false,
}: CardPreviewProps) {
  const [activeFaceId, setActiveFaceId] = useState(
    () => card.faces[0]?.faceId ?? 'front',
  );
  const reconciliation = reconcileCard(card, profile);
  const activeFace =
    getCardFaceById(card, faceId ?? activeFaceId) ?? getCardFace(card);
  const activeFaceReconciliation =
    reconciliation.faces.find((face) => face.faceId === activeFace.faceId) ??
    reconciliation.faces[0];
  const rootFields = reconciliation.fields.filter(
    (field) => field.definition.target === 'root',
  );
  const faceFields = activeFaceReconciliation?.fields ?? [];
  const displayName =
    activeFace.name !== undefined && activeFace.name.trim().length > 0
      ? activeFace.name
      : card.name;
  const displayCardType = activeFace.cardType ?? card.cardType;
  const displaySubtypes = activeFace.subtypes ?? card.subtypes;
  const values = [...rootFields, ...faceFields].filter(
    (field) => field.value !== undefined,
  );
  const fieldsByKey = new Map(
    [...rootFields, ...faceFields].map((field) => [
      field.definition.key,
      field,
    ]),
  );
  const sortedBlocks =
    template === null
      ? []
      : [...template.blocks].sort((left, right) => left.order - right.order);
  const mappedFieldKeys = new Set(
    sortedBlocks.flatMap((block) =>
      block.mappingKey !== undefined && fieldsByKey.has(block.mappingKey)
        ? [block.mappingKey]
        : [],
    ),
  );
  const unclaimedValues = values.filter(
    (field) => !mappedFieldKeys.has(field.definition.key),
  );
  const artReference =
    activeFace.artAssetId === null
      ? null
      : (assets.find(
          (asset) => asset.assetId === activeFace.artAssetId,
        ) ?? null);
  const missingArtworkReference =
    activeFace.artAssetId !== null && artReference === null;
  const artwork = useVerifiedArtwork(artReference);
  const fullCardAssetId = activeFace.fullCardAssetId ?? null;
  const fullCardReference =
    fullCardAssetId === null
      ? null
      : (assets.find((asset) => asset.assetId === fullCardAssetId) ?? null);
  const missingFullCardReference =
    fullCardAssetId !== null && fullCardReference === null;
  const fullCardArtwork = useVerifiedArtwork(fullCardReference);
  const showFullCard = fullCardAssetId !== null;

  function renderFullCardImage() {
    if (missingFullCardReference) {
      return (
        <div className="card-preview__full-card-placeholder">
          <span>Full-card image reference missing</span>
          <small>
            The card points at an image that is not in the project manifest.
          </small>
        </div>
      );
    }

    if (fullCardArtwork.status === 'verified') {
      return (
        <VerifiedArtworkImage
          key={fullCardArtwork.objectUrl}
          objectUrl={fullCardArtwork.objectUrl}
          alt={`Full card image for ${displayName.trim().length === 0 ? 'untitled card' : displayName}`}
        />
      );
    }

    if (fullCardArtwork.status === 'loading') {
      return (
        <div className="card-preview__full-card-placeholder">
          <span>Verifying full-card image…</span>
          <small>Checking the stored image against its content hash.</small>
        </div>
      );
    }

    if (fullCardArtwork.status === 'invalid') {
      return (
        <div className="card-preview__full-card-placeholder card-preview__full-card-placeholder--error">
          <span>Full-card image could not be verified</span>
          <small>
            {fullCardArtwork.issues[0]?.message ??
              'The stored image does not match its content hash.'}
          </small>
        </div>
      );
    }

    if (fullCardArtwork.status === 'missing') {
      return (
        <div className="card-preview__full-card-placeholder">
          <span>Full-card image file missing</span>
          <small>
            The manifest references an image whose bytes are not in this
            browser.
          </small>
        </div>
      );
    }

    if (fullCardArtwork.status === 'error') {
      return (
        <div className="card-preview__full-card-placeholder card-preview__full-card-placeholder--error">
          <span>Could not load the full-card image</span>
          <small>{fullCardArtwork.message}</small>
        </div>
      );
    }

    return (
      <div className="card-preview__full-card-placeholder">
        <span>Full-card image not linked</span>
        <small>Attach one from the card editor.</small>
      </div>
    );
  }

  function renderArtwork() {
    if (missingArtworkReference) {
      return (
        <>
          <span>Artwork reference missing</span>
          <small>
            The card points at an image that is not in the project manifest.
          </small>
        </>
      );
    }

    if (artwork.status === 'verified') {
      return (
        <VerifiedArtworkImage
          key={artwork.objectUrl}
          objectUrl={artwork.objectUrl}
          alt={`Artwork for ${displayName.trim().length === 0 ? 'untitled card' : displayName}`}
        />
      );
    }

    if (artwork.status === 'loading') {
      return (
        <>
          <span>Verifying artwork…</span>
          <small>Checking the stored image against its content hash.</small>
        </>
      );
    }

    if (artwork.status === 'invalid') {
      return (
        <>
          <span>Artwork could not be verified</span>
          <small>
            {artwork.issues[0]?.message ??
              'The stored image does not match its content hash.'}
          </small>
        </>
      );
    }

    if (artwork.status === 'missing') {
      return (
        <>
          <span>Artwork file missing</span>
          <small>
            The manifest references an image whose bytes are not in this
            browser.
          </small>
        </>
      );
    }

    if (artwork.status === 'error') {
      return (
        <>
          <span>Could not load artwork</span>
          <small>{artwork.message}</small>
        </>
      );
    }

    return (
      <>
        <span>Artwork not linked</span>
        <small>Attach artwork from the card editor.</small>
      </>
    );
  }

  function renderBlock(block: TemplateBlock) {
    const tokenClass = DESIGN_TOKEN_CLASS_NAMES[block.designTokenStyle];

    switch (block.type) {
      case 'header':
        return (
          <header
            key={block.id}
            className={`card-preview__header ${tokenClass}`}
          >
            <div>
              <p className="eyebrow">Card preview</p>
              <h3>
                {displayName.trim().length === 0 ? 'Untitled card' : displayName}
              </h3>
              <p className="card-preview__type">
                {displayCardType.trim().length === 0
                  ? 'No card type'
                  : displayCardType}
                {displaySubtypes.length === 0
                  ? ''
                  : ` — ${displaySubtypes.join(' / ')}`}
              </p>
            </div>

            {card.tags.length === 0 ? null : (
              <div className="card-preview__tags" aria-label="Card tags">
                {card.tags.map((tag) => (
                  <span className="chip chip--muted" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>
        );

      case 'art_box':
        if (block.hideWhenEmpty === true && activeFace.artAssetId === null) {
          return null;
        }

        return (
          <div
            key={block.id}
            className={`card-preview__art ${tokenClass}${
              artwork.status === 'verified'
                ? ' card-preview__art--image'
                : ''
            }`}
            aria-label={
              artwork.status === 'verified'
                ? 'Card artwork'
                : 'Artwork status'
            }
          >
            {renderArtwork()}
          </div>
        );

      case 'textbox': {
        const isFlavor = block.mappingKey === 'flavorText';
        const text = isFlavor
          ? (activeFace.flavorText ?? '')
          : activeFace.rulesText;
        const emptyText = isFlavor ? 'No flavor text yet.' : 'No rules text yet.';

        if (block.hideWhenEmpty === true && text.trim().length === 0) {
          return null;
        }

        return (
          <div
            key={block.id}
            className={`card-preview__text ${tokenClass}`}
          >
            <p className={isFlavor ? 'card-preview__flavor' : undefined}>
              {text.trim().length === 0 ? emptyText : text}
            </p>
          </div>
        );
      }

      case 'stat_badge': {
        const field =
          block.mappingKey === undefined
            ? undefined
            : fieldsByKey.get(block.mappingKey);
        const definition =
          field?.definition ??
          (block.mappingKey === undefined
            ? undefined
            : profile.fieldDefinitions.find(
                (item) => item.key === block.mappingKey,
              ));
        const hasValue = isPresentFieldValue(field?.value);

        if (block.hideWhenEmpty === true && !hasValue) {
          return null;
        }

        return (
          <div
            key={block.id}
            className={`card-preview__stat-badge ${tokenClass}`}
          >
            {definition === undefined ? (
              <span>Unmapped stat</span>
            ) : (
              <>
                <span>{definition.label}</span>
                <strong>
                  {hasValue && field?.value !== undefined
                    ? formatFieldValue(field.value)
                    : '—'}
                </strong>
              </>
            )}
          </div>
        );
      }

      case 'splitter':
        return (
          <hr
            key={block.id}
            className={`card-preview__splitter ${tokenClass}`}
          />
        );

      case 'structured_list': {
        const field =
          block.mappingKey === undefined
            ? undefined
            : fieldsByKey.get(block.mappingKey);
        const definition =
          field?.definition ??
          (block.mappingKey === undefined
            ? undefined
            : profile.fieldDefinitions.find(
                (item) => item.key === block.mappingKey,
              ));
        const entries: StructuredFieldEntry[] = Array.isArray(field?.value)
          ? field.value.filter(
              (item): item is StructuredFieldEntry =>
                typeof item === 'object' &&
                item !== null &&
                !Array.isArray(item) &&
                typeof item.entryId === 'string' &&
                typeof item.values === 'object',
            )
          : [];
        const hasEntries = entries.length > 0;

        if (block.hideWhenEmpty === true && !hasEntries) {
          return null;
        }

        const structuredType =
          definition?.type.type === 'structured' ? definition.type : null;

        return (
          <div
            key={block.id}
            className={`card-preview__structured ${tokenClass}`}
          >
            <span className="card-preview__structured-label">
              {definition?.label ?? 'Structured value'}
            </span>
            {structuredType === null || !hasEntries ? (
              <span className="card-preview__empty-fields">—</span>
            ) : (
              <ul className="card-preview__structured-list">
                {entries.map((entry) => (
                  <li key={entry.entryId}>
                    {structuredType.children.map((child) => {
                      const childValue = entry.values[child.key];

                      return childValue === undefined ? null : (
                        <span
                          className="chip chip--muted"
                          key={child.key}
                        >
                          {child.label}: {formatFieldValue(childValue)}
                        </span>
                      );
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }

      case 'tag_list': {
        const items =
          block.mappingKey === 'tags'
            ? card.tags
            : block.mappingKey === 'subtypes'
              ? displaySubtypes
              : [];

        if (block.hideWhenEmpty === true && items.length === 0) {
          return null;
        }

        return (
          <div
            key={block.id}
            className={`card-preview__tag-block ${tokenClass}`}
          >
            {items.length === 0 ? (
              <span className="card-preview__empty-fields">
                No tags or subtypes.
              </span>
            ) : (
              items.map((item) => (
                <span className="chip chip--muted" key={item}>
                  {item}
                </span>
              ))
            )}
          </div>
        );
      }
    }
  }

  function renderUnclaimedFields() {
    if (unclaimedValues.length === 0) {
      return null;
    }

    return (
      <div className="card-preview__unclaimed">
        <p className="card-preview__unclaimed-title">
          Unmapped profile fields
        </p>
        <dl className="card-preview__stats">
          {unclaimedValues.map((field) => (
            <div key={`${field.definition.target}-${field.definition.key}`}>
              <dt>{field.definition.label}</dt>
              <dd>
                {field.value === undefined
                  ? '—'
                  : formatFieldValue(field.value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const RootElement = compact ? 'div' : 'article';

  return (
    <RootElement
      className={`card-preview${compact ? ' card-preview--compact' : ''}`}
      aria-label={`Preview of ${displayName || 'untitled card'}`}
    >
      {compact || card.faces.length <= 1 ? null : (
        <div className="face-tabs face-tabs--preview" role="tablist" aria-label="Preview face">
          {card.faces.map((cardFace, index) => {
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
        </div>
      )}
      {showFullCard ? (
        <div className="card-preview__full-card">
          {renderFullCardImage()}
        </div>
      ) : (
        <div className="card-preview__frame">
          {template === null ? (
            <p className="card-preview__empty-fields">
              This card references a template that is not in the project.
            </p>
          ) : sortedBlocks.length === 0 ? (
            <p className="card-preview__empty-fields">
              This template has no blocks.
            </p>
          ) : (
            sortedBlocks.map(renderBlock)
          )}
          {compact ? null : renderUnclaimedFields()}
        </div>
      )}

      {compact ? null : reconciliation.issues.length === 0 ? null : (
        <div
          className="card-preview__warning card-preview__warning--error"
          role="status"
        >
          <p>
            This card needs attention before it can be saved:
          </p>
          <ul>
            {reconciliation.issues.slice(0, 4).map((issue, index) => (
              <li key={`${issue.path}-${issue.code}-${index}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {compact || reconciliation.orphaned.length === 0 ? null : (
        <div className="card-preview__warning" role="status">
          <p>
            {reconciliation.orphaned.length} value
            {reconciliation.orphaned.length === 1 ? '' : 's'} no longer{' '}
            {reconciliation.orphaned.length === 1 ? 'matches' : 'match'} the
            profile and{' '}
            {reconciliation.orphaned.length === 1 ? 'is' : 'are'} preserved:
          </p>
          <ul>
            {reconciliation.orphaned.map((attribute) => (
              <li
                key={`${attribute.target}-${attribute.faceId ?? 'root'}-${attribute.key}`}
              >
                <code>{attribute.key}</code>
                {attribute.faceId === undefined
                  ? ''
                  : ` (${attribute.faceId})`}{' '}
                = {formatFieldValue(attribute.value)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </RootElement>
  );
}
