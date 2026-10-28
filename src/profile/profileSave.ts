import type { GameProfile } from '../types/Game';
import { isProfileDraftDirty } from './profileFactory';

export interface CompletedProfileSave {
  readonly profile: GameProfile;
  readonly draft: GameProfile;
  readonly savedAt: string;
}

/**
 * Reconciles state after a profile write finishes.
 *
 * The submitted snapshot becomes the persisted profile. If the user edited the
 * draft while IndexedDB was writing, that newer draft is preserved and remains
 * marked unsaved rather than being replaced by stale save-time data.
 */
export function completeProfileSave(
  submittedProfile: GameProfile,
  currentDraft: GameProfile | null,
  savedAt: string,
): CompletedProfileSave {
  if (
    currentDraft === null ||
    !isProfileDraftDirty(submittedProfile, currentDraft)
  ) {
    return {
      profile: submittedProfile,
      draft: structuredClone(submittedProfile),
      savedAt,
    };
  }

  return {
    profile: submittedProfile,
    draft: currentDraft,
    savedAt,
  };
}
