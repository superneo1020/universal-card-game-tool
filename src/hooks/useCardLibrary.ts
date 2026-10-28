import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearStoredCardLibrary,
  loadStoredCardLibrary,
  saveStoredCardLibrary,
} from '../storage/cardStore';
import type { CardRecord } from '../types/CardRecord';
import type { GameProfile } from '../types/Game';
import { toErrorMessage } from '../utils/errors';
import type { ValidationIssue } from '../utils/validation';

export interface CardLibraryState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly profileId: string | null;
  readonly cards: readonly CardRecord[];
  readonly loadErrorMessage: string | null;
  readonly loadIssues: readonly ValidationIssue[];
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly savedAt: string | null;
}

const EMPTY_STATE: CardLibraryState = {
  status: 'ready',
  profileId: null,
  cards: [],
  loadErrorMessage: null,
  loadIssues: [],
  saving: false,
  saveErrorMessage: null,
  savedAt: null,
};

const LOADING_STATE: CardLibraryState = {
  ...EMPTY_STATE,
  status: 'loading',
};

function assertNever(value: never): never {
  throw new Error(`Unhandled card library load result: ${String(value)}`);
}

/**
 * Applies a successful write only when the state still belongs to the profile
 * that initiated it. A delayed write for a previous profile is ignored.
 */
export function completeCardLibraryWrite(
  current: CardLibraryState,
  operationProfileId: string | null,
  cards: readonly CardRecord[],
  savedAt: string,
): CardLibraryState {
  if (current.profileId !== operationProfileId) {
    return current;
  }

  return { ...current, saving: false, cards, savedAt };
}

export interface UseCardLibraryResult {
  readonly state: CardLibraryState;
  readonly saveCard: (card: CardRecord) => Promise<boolean>;
  readonly deleteCard: (cardId: string) => Promise<boolean>;
  readonly clearLibrary: () => Promise<boolean>;
  readonly reload: () => void;
}

/**
 * Loads and persists the card library for the active profile.
 *
 * Libraries are keyed by profile id, so a reset/new profile starts with a clean
 * library while old records remain isolated in IndexedDB.
 */
export function useCardLibrary(
  profile: GameProfile | null,
): UseCardLibraryResult {
  const [state, setState] = useState<CardLibraryState>(LOADING_STATE);
  const requestId = useRef(0);
  const profileId = profile?.id ?? null;

  const load = useCallback(async () => {
    if (profileId === null) {
      requestId.current += 1;
      setState(EMPTY_STATE);
      return;
    }

    const currentRequest = ++requestId.current;
    setState((current) => ({
      ...current,
      profileId,
      status: 'loading',
      loadErrorMessage: null,
      loadIssues: [],
    }));

    const result = await loadStoredCardLibrary(profileId);
    if (currentRequest !== requestId.current) {
      return;
    }

    switch (result.kind) {
      case 'empty':
        setState({ ...EMPTY_STATE, profileId });
        return;

      case 'loaded':
        setState({
          ...EMPTY_STATE,
          profileId,
          cards: result.cards,
        });
        return;

      case 'invalid':
        setState({
          ...EMPTY_STATE,
          profileId,
          status: 'error',
          loadIssues: result.issues,
        });
        return;

      case 'error':
        setState({
          ...EMPTY_STATE,
          profileId,
          status: 'error',
          loadErrorMessage: result.message,
        });
        return;

      default:
        return assertNever(result);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistCards = useCallback(
    async (cards: readonly CardRecord[]): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }

      const operationProfileId = profileId;

      setState((current) =>
        current.profileId === operationProfileId
          ? { ...current, saving: true, saveErrorMessage: null }
          : current,
      );

      try {
        await saveStoredCardLibrary(operationProfileId, cards);
        setState((current) =>
          completeCardLibraryWrite(
            current,
            operationProfileId,
            cards,
            new Date().toISOString(),
          ),
        );
        return true;
      } catch (error) {
        setState((current) =>
          current.profileId === operationProfileId
            ? {
                ...current,
                saving: false,
                saveErrorMessage: toErrorMessage(error),
              }
            : current,
        );
        return false;
      }
    },
    [profileId],
  );

  const saveCard = useCallback(
    async (card: CardRecord): Promise<boolean> => {
      const existingIndex = state.cards.findIndex((item) => item.id === card.id);
      const nextCards =
        existingIndex === -1
          ? [...state.cards, card]
          : state.cards.map((item, index) =>
              index === existingIndex ? card : item,
            );

      return persistCards(nextCards);
    },
    [persistCards, state.cards],
  );

  const deleteCard = useCallback(
    async (cardId: string): Promise<boolean> =>
      persistCards(state.cards.filter((card) => card.id !== cardId)),
    [persistCards, state.cards],
  );

  const clearLibrary = useCallback(async (): Promise<boolean> => {
    if (profileId === null) {
      return false;
    }

    const operationProfileId = profileId;

    setState((current) =>
      current.profileId === operationProfileId
        ? { ...current, saving: true, saveErrorMessage: null }
        : current,
    );

    try {
      await clearStoredCardLibrary(operationProfileId);
      setState((current) =>
        current.profileId === operationProfileId
          ? {
              ...EMPTY_STATE,
              profileId: operationProfileId,
              savedAt: new Date().toISOString(),
            }
          : current,
      );
      return true;
    } catch (error) {
      setState((current) =>
        current.profileId === operationProfileId
          ? {
              ...current,
              saving: false,
              saveErrorMessage: toErrorMessage(error),
            }
          : current,
      );
      return false;
    }
  }, [profileId]);

  return {
    state,
    saveCard,
    deleteCard,
    clearLibrary,
    reload: load,
  };
}
