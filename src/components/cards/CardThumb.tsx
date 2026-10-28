import type { CardTemplate } from '../../types/Card';
import type { CardRecord } from '../../types/CardRecord';
import type { GameProfile } from '../../types/Game';
import type { AssetReference } from '../../types/ProjectManifest';
import { CardPreview } from './CardPreview';

interface CardThumbProps {
  readonly card: CardRecord;
  readonly profile: GameProfile;
  readonly assets: readonly AssetReference[];
  readonly template: CardTemplate | null;
}

/** Small non-interactive card visual for curation lists and deck rows. */
export function CardThumb({
  card,
  profile,
  assets,
  template,
}: CardThumbProps) {
  return (
    <span className="card-thumb" aria-hidden="true">
      <CardPreview
        card={card}
        profile={profile}
        assets={assets}
        template={template}
        compact
      />
    </span>
  );
}
