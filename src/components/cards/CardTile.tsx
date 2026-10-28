import type { CardTemplate } from '../../types/Card';
import type { CardRecord } from '../../types/CardRecord';
import type { GameProfile } from '../../types/Game';
import type { AssetReference } from '../../types/ProjectManifest';
import { CardPreview } from './CardPreview';

interface CardTileProps {
  readonly card: CardRecord;
  readonly profile: GameProfile;
  readonly assets: readonly AssetReference[];
  readonly template: CardTemplate | null;
  readonly quantity?: number;
  readonly selected?: boolean;
  /** Omit for a static tile inside a read-only collection detail. */
  readonly onSelect?: () => void;
}

function displayName(card: CardRecord): string {
  return card.name.trim().length === 0 ? 'Untitled card' : card.name;
}

function displayType(card: CardRecord): string {
  const subtypes =
    card.subtypes.length === 0 ? '' : ` · ${card.subtypes.join(' / ')}`;

  return `${card.cardType.trim().length === 0 ? 'No card type' : card.cardType}${subtypes}`;
}

/**
 * Shared visual card tile for library, pack, and deck views.
 *
 * The tile uses the compact template preview, which already prefers a verified
 * full-card image when one is attached. The name is rendered outside the visual
 * so a missing template or image can never hide the card identity.
 */
export function CardTile({
  card,
  profile,
  assets,
  template,
  quantity,
  selected,
  onSelect,
}: CardTileProps) {
  const RootElement = onSelect === undefined ? 'div' : 'button';
  const interactiveProps =
    onSelect === undefined
      ? {}
      : { type: 'button' as const, onClick: onSelect };

  return (
    <RootElement
      {...interactiveProps}
      className={`card-tile${selected === true ? ' card-tile--selected' : ''}`}
      aria-pressed={
        onSelect === undefined || selected === undefined ? undefined : selected
      }
    >
      <span className="card-tile__visual">
        <CardPreview
          card={card}
          profile={profile}
          assets={assets}
          template={template}
          compact
        />
        {quantity === undefined ? null : (
          <span
            className="card-tile__quantity"
            aria-label={`${quantity} cop${quantity === 1 ? 'y' : 'ies'}`}
          >
            ×{quantity}
          </span>
        )}
      </span>
      <span className="card-tile__footer">
        <span className="card-tile__name">{displayName(card)}</span>
        <span className="card-tile__meta">{displayType(card)}</span>
      </span>
    </RootElement>
  );
}

interface MissingCardTileProps {
  readonly cardId: string;
  readonly quantity?: number;
}

/** Fallback tile for a stale pack/deck reference. */
export function MissingCardTile({ cardId, quantity }: MissingCardTileProps) {
  return (
    <div className="card-tile card-tile--missing">
      <span className="card-tile__visual card-tile__visual--missing">
        <span>Missing card</span>
        <small>
          This reference no longer matches a card in the project.
        </small>
      </span>
      <span className="card-tile__footer">
        <span className="card-tile__name">{cardId}</span>
        {quantity === undefined ? null : (
          <span className="card-tile__meta">×{quantity}</span>
        )}
      </span>
    </div>
  );
}
