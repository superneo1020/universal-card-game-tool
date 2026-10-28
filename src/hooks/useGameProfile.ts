import { useCallback, useEffect, useRef, useState } from 'react';

import { createBlankGameProfile } from '../profile/profileFactory';
import { completeProfileSave } from '../profile/profileSave';
import {
  clearStoredGameProfile,
  loadStoredGameProfile,
  saveStoredGameProfile,
} from '../storage/profileStore';
import type { GameProfile } from '../types/Game';
import type { ValidationIssue } from '../utils/validation';
import { validateGameProfile } from '../utils/validation';

export interface GameProfileState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly profile: GameProfile | null;
  readonly draft: GameProfile | null;
  readonly loadErrorMessage: string | null;
  readonly loadIssues: readonly ValidationIssue[];
  readonly saving: boolean;
  readonly saveIssues: readonly ValidationIssue[];
  readonly saveErrorMessage: string | null;
  readonly savedAt: string | null;
}

const INITIAL_STATE: GameProfileState = {
  status: 'loading',
  profile: null,
  draft: null,
  loadErrorMessage: null,
  loadIssues: [],
  saving: false,
  saveIssues: [],
  saveErrorMessage: null,
  savedAt: null,
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled profile load result: ${String(value)}`);
}

export interface UseGameProfileResult {
  readonly state: GameProfileState;
  readonly updateDraft: (updater: (draft: GameProfile) => GameProfile) => void;
  readonly saveDraft: () => Promise<void>;
  readonly discardDraft: () => void;
  readonly reload: () => void;
  readonly resetStoredProfile: () => Promise<void>;
}

/**
 * Owns the game-profile lifecycle: load from IndexedDB, edit a draft, validate
 * and persist, and expose explicit loading/saving/error states.
 *
 * The draft lives at the app level so switching workspace sections does not
 * discard unsaved edits.
 */
export function useGameProfile(): UseGameProfileResult {
  const [state, setState] = useState<GameProfileState>(INITIAL_STATE);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;

    setState((current) => ({
      ...current,
      status: 'loading',
      loadErrorMessage: null,
      loadIssues: [],
    }));

    const result = await loadStoredGameProfile();

    // Ignore stale loads (for example the double effect invocation in React
    // StrictMode) so an older response cannot overwrite a newer one.
    if (requestId !== loadRequestId.current) {
      return;
    }

    switch (result.kind) {
      case 'empty':
        setState({
          ...INITIAL_STATE,
          status: 'ready',
          draft: createBlankGameProfile(),
        });
        return;

      case 'loaded':
        setState({
          ...INITIAL_STATE,
          status: 'ready',
          profile: result.profile,
          draft: structuredClone(result.profile),
        });
        return;

      case 'invalid':
        setState({
          ...INITIAL_STATE,
          status: 'error',
          loadIssues: result.issues,
        });
        return;

      case 'error':
        setState({
          ...INITIAL_STATE,
          status: 'error',
          loadErrorMessage: result.message,
        });
        return;

      default:
        return assertNever(result);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = useCallback(
    (updater: (draft: GameProfile) => GameProfile) => {
      setState((current) => {
        if (current.draft === null) {
          return current;
        }

        return {
          ...current,
          draft: updater(current.draft),
          saveIssues: [],
          saveErrorMessage: null,
        };
      });
    },
    [],
  );

  const saveDraft = useCallback(async () => {
    const draft = state.draft;
    if (draft === null || state.saving) {
      return;
    }

    const validation = validateGameProfile(draft);
    if (!validation.ok) {
      setState((current) => ({ ...current, saveIssues: validation.issues }));
      return;
    }

    setState((current) => ({
      ...current,
      saving: true,
      saveIssues: [],
      saveErrorMessage: null,
    }));

    try {
      await saveStoredGameProfile(validation.value);
      setState((current) => {
        const completed = completeProfileSave(
          validation.value,
          current.draft,
          new Date().toISOString(),
        );

        return {
          ...current,
          saving: false,
          profile: completed.profile,
          draft: completed.draft,
          savedAt: completed.savedAt,
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        saveErrorMessage: toErrorMessage(error),
      }));
    }
  }, [state.draft, state.saving]);

  const discardDraft = useCallback(() => {
    setState((current) => ({
      ...current,
      draft:
        current.profile === null
          ? createBlankGameProfile()
          : structuredClone(current.profile),
      saveIssues: [],
      saveErrorMessage: null,
    }));
  }, []);

  const resetStoredProfile = useCallback(async () => {
    setState((current) => ({
      ...current,
      saving: true,
      loadErrorMessage: null,
      loadIssues: [],
      saveErrorMessage: null,
    }));

    try {
      await clearStoredGameProfile();
      setState({
        ...INITIAL_STATE,
        status: 'ready',
        draft: createBlankGameProfile(),
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        saving: false,
        loadIssues: [],
        loadErrorMessage: toErrorMessage(error),
      }));
    }
  }, []);

  return {
    state,
    updateDraft,
    saveDraft,
    discardDraft,
    reload: load,
    resetStoredProfile,
  };
}
