import { useCallback, useEffect, useRef, useState } from 'react';

import { isCardRecordShape } from '../cards/cardModel';
import {
  createBlankGameProfile,
  isProfileDraftDirty,
} from '../profile/profileFactory';
import {
  applyProfileToProject,
  clearProjectCards,
  createProjectManifest,
  mergeProjectManifests,
  removeProjectCard,
  removeProjectDeck,
  removeProjectPack,
  removeProjectTemplate,
  upsertProjectAssets,
  upsertProjectCard,
  upsertProjectDeck,
  upsertProjectPack,
  upsertProjectTemplate,
  validateStoredProject,
} from '../project/projectModel';
import {
  clearStoredProject,
  loadStoredProject,
  saveStoredProject,
} from '../storage/projectStore';
import { saveVerifiedAsset } from '../storage/assetStore';
import type { CardTemplate } from '../types/Card';
import type { CardRecord } from '../types/CardRecord';
import type { CardPack, Deck } from '../types/Collection';
import type { GameProfile } from '../types/Game';
import type { AssetReference, ProjectManifest } from '../types/ProjectManifest';
import { toErrorMessage } from '../utils/errors';
import type { ValidationIssue } from '../utils/validation';
import {
  computeSha256Hex,
  validateGameProfile,
  validateProjectManifest,
} from '../utils/validation';

export interface ProjectState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly project: ProjectManifest | null;
  readonly profileDraft: GameProfile | null;
  readonly loadErrorMessage: string | null;
  readonly loadIssues: readonly ValidationIssue[];
  readonly saving: boolean;
  readonly saveIssues: readonly ValidationIssue[];
  readonly saveErrorMessage: string | null;
  readonly savedAt: string | null;
  readonly profileSavedAt: string | null;
}

const INITIAL_STATE: ProjectState = {
  status: 'loading',
  project: null,
  profileDraft: null,
  loadErrorMessage: null,
  loadIssues: [],
  saving: false,
  saveIssues: [],
  saveErrorMessage: null,
  savedAt: null,
  profileSavedAt: null,
};

function assertNever(value: never): never {
  throw new Error(`Unhandled project load result: ${String(value)}`);
}

/**
 * Applies a profile save only when its operation generation is still active.
 * A save that finishes after a reload/reset is ignored.
 */
export function completeProfileProjectSave(
  current: ProjectState,
  operationGeneration: number,
  currentGeneration: number,
  submittedProfile: GameProfile,
  savedProject: ProjectManifest,
  savedAt: string,
): ProjectState {
  if (currentGeneration !== operationGeneration) {
    return current;
  }

  const hasNewerEdits =
    current.profileDraft !== null &&
    isProfileDraftDirty(submittedProfile, current.profileDraft);

  return {
    ...current,
    saving: false,
    project: savedProject,
    profileDraft: hasNewerEdits
      ? current.profileDraft
      : structuredClone(submittedProfile),
    savedAt,
    profileSavedAt: savedAt,
  };
}

/** Applies a card write only when its operation generation is still active. */
export function completeProjectWrite(
  current: ProjectState,
  operationGeneration: number,
  currentGeneration: number,
  savedProject: ProjectManifest,
  savedAt: string,
): ProjectState {
  if (currentGeneration !== operationGeneration) {
    return current;
  }

  return {
    ...current,
    saving: false,
    project: savedProject,
    savedAt,
  };
}

export interface ArtworkImportResult {
  readonly imported: readonly AssetReference[];
  readonly errors: readonly string[];
}

export type ProjectImportPolicy = 'replace' | 'merge';

export interface UseProjectResult {
  readonly state: ProjectState;
  readonly updateProfileDraft: (
    updater: (draft: GameProfile) => GameProfile,
  ) => void;
  readonly saveProfile: () => Promise<boolean>;
  readonly discardProfileDraft: () => void;
  readonly saveCard: (card: CardRecord) => Promise<boolean>;
  readonly deleteCard: (cardId: string) => Promise<boolean>;
  readonly clearCards: () => Promise<boolean>;
  readonly importArtwork: (
    files: readonly File[],
  ) => Promise<ArtworkImportResult>;
  readonly importProject: (
    manifest: ProjectManifest,
    policy: ProjectImportPolicy,
    assetBytes: ReadonlyMap<string, Uint8Array>,
  ) => Promise<boolean>;
  readonly savePack: (pack: CardPack) => Promise<boolean>;
  readonly deletePack: (packId: string) => Promise<boolean>;
  readonly saveDeck: (deck: Deck) => Promise<boolean>;
  readonly deleteDeck: (deckId: string) => Promise<boolean>;
  readonly saveTemplate: (template: CardTemplate) => Promise<boolean>;
  readonly deleteTemplate: (templateId: string) => Promise<boolean>;
  readonly reload: () => void;
  readonly resetProject: () => Promise<void>;
}

/**
 * Owns the single project master copy: profile draft, templates, cards, and
 * persistence. Profile and card writes are serialized through one `saving`
 * flag, and a generation token prevents delayed writes from updating state
 * after a reload or reset.
 */
export function useProject(): UseProjectResult {
  const [state, setState] = useState<ProjectState>(INITIAL_STATE);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const operationGeneration = ++generation.current;

    setState((current) => ({
      ...current,
      status: 'loading',
      loadErrorMessage: null,
      loadIssues: [],
      saveIssues: [],
      saveErrorMessage: null,
    }));

    const result = await loadStoredProject();

    if (generation.current !== operationGeneration) {
      return;
    }

    switch (result.kind) {
      case 'empty':
        setState({
          ...INITIAL_STATE,
          status: 'ready',
          profileDraft: createBlankGameProfile(),
        });
        return;

      case 'loaded':
        setState({
          ...INITIAL_STATE,
          status: 'ready',
          project: result.project,
          profileDraft: structuredClone(result.project.profile),
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

  const updateProfileDraft = useCallback(
    (updater: (draft: GameProfile) => GameProfile) => {
      setState((current) => {
        if (current.profileDraft === null) {
          return current;
        }

        return {
          ...current,
          profileDraft: updater(current.profileDraft),
          saveIssues: [],
          saveErrorMessage: null,
        };
      });
    },
    [],
  );

  const discardProfileDraft = useCallback(() => {
    setState((current) => ({
      ...current,
      profileDraft:
        current.project === null
          ? createBlankGameProfile()
          : structuredClone(current.project.profile),
      saveIssues: [],
      saveErrorMessage: null,
    }));
  }, []);

  const saveProfile = useCallback(async (): Promise<boolean> => {
    const draft = state.profileDraft;
    if (draft === null || state.saving) {
      return false;
    }

    const validation = validateGameProfile(draft);
    if (!validation.ok) {
      setState((current) => ({ ...current, saveIssues: validation.issues }));
      return false;
    }

    if (
      state.project !== null &&
      state.project.profile.id !== validation.value.id
    ) {
      setState((current) => ({
        ...current,
        saveErrorMessage:
          'The profile id cannot change while a project exists.',
      }));
      return false;
    }

    const nextProject =
      state.project === null
        ? createProjectManifest(validation.value)
        : applyProfileToProject(state.project, validation.value);

    const projectValidation = validateStoredProject(nextProject);
    if (!projectValidation.ok) {
      setState((current) => ({
        ...current,
        saveIssues: projectValidation.issues,
      }));
      return false;
    }

    const operationGeneration = generation.current;

    setState((current) => ({
      ...current,
      saving: true,
      saveIssues: [],
      saveErrorMessage: null,
    }));

    try {
      await saveStoredProject(projectValidation.value);
      if (generation.current !== operationGeneration) {
        return false;
      }

      const savedAt = new Date().toISOString();
      setState((current) =>
        completeProfileProjectSave(
          current,
          operationGeneration,
          generation.current,
          validation.value,
          projectValidation.value,
          savedAt,
        ),
      );
      return true;
    } catch (error) {
      if (generation.current !== operationGeneration) {
        return false;
      }

      setState((current) => ({
        ...current,
        saving: false,
        saveErrorMessage: toErrorMessage(error),
      }));
      return false;
    }
  }, [state]);

  const persistProject = useCallback(
    async (
      nextProject: ProjectManifest,
      failureMessage: string,
    ): Promise<boolean> => {
      const validation = validateStoredProject(nextProject);

      if (!validation.ok) {
        setState((current) => ({
          ...current,
          saveIssues: validation.issues,
          saveErrorMessage: failureMessage,
        }));
        return false;
      }

      const operationGeneration = generation.current;

      setState((current) => ({
        ...current,
        saving: true,
        saveIssues: [],
        saveErrorMessage: null,
      }));

      try {
        await saveStoredProject(validation.value);
        if (generation.current !== operationGeneration) {
          return false;
        }

        setState((current) =>
          completeProjectWrite(
            current,
            operationGeneration,
            generation.current,
            validation.value,
            new Date().toISOString(),
          ),
        );
        return true;
      } catch (error) {
        if (generation.current !== operationGeneration) {
          return false;
        }

        setState((current) => ({
          ...current,
          saving: false,
          saveErrorMessage: toErrorMessage(error),
        }));
        return false;
      }
    },
    [],
  );

  const saveCard = useCallback(
    async (card: CardRecord): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      if (card.profileId !== project.profile.id) {
        setState((current) => ({
          ...current,
          saveErrorMessage: 'Card belongs to a different game profile.',
        }));
        return false;
      }

      if (!isCardRecordShape(card)) {
        setState((current) => ({
          ...current,
          saveErrorMessage: 'Card record is malformed.',
        }));
        return false;
      }

      return persistProject(
        upsertProjectCard(project, card),
        'Card could not be saved.',
      );
    },
    [state, persistProject],
  );

  const deleteCard = useCallback(
    async (cardId: string): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      return persistProject(
        removeProjectCard(project, cardId),
        'Card could not be deleted.',
      );
    },
    [state, persistProject],
  );

  const clearCards = useCallback(async (): Promise<boolean> => {
    const project = state.project;
    if (project === null || state.saving) {
      return false;
    }

    return persistProject(
      clearProjectCards(project),
      'Cards could not be cleared.',
    );
  }, [state, persistProject]);

  const savePack = useCallback(
    async (pack: CardPack): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      return persistProject(
        upsertProjectPack(project, pack),
        'Pack could not be saved.',
      );
    },
    [state, persistProject],
  );

  const deletePack = useCallback(
    async (packId: string): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      return persistProject(
        removeProjectPack(project, packId),
        'Pack could not be deleted.',
      );
    },
    [state, persistProject],
  );

  const saveDeck = useCallback(
    async (deck: Deck): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      if (deck.profileId !== project.profile.id) {
        setState((current) => ({
          ...current,
          saveErrorMessage: 'Deck belongs to a different game profile.',
        }));
        return false;
      }

      return persistProject(
        upsertProjectDeck(project, deck),
        'Deck could not be saved.',
      );
    },
    [state, persistProject],
  );

  const deleteDeck = useCallback(
    async (deckId: string): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      return persistProject(
        removeProjectDeck(project, deckId),
        'Deck could not be deleted.',
      );
    },
    [state, persistProject],
  );

  const saveTemplate = useCallback(
    async (template: CardTemplate): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      if (template.profileId !== project.profile.id) {
        setState((current) => ({
          ...current,
          saveErrorMessage: 'Template belongs to a different game profile.',
        }));
        return false;
      }

      return persistProject(
        upsertProjectTemplate(project, template),
        'Template could not be saved.',
      );
    },
    [state, persistProject],
  );

  const importArtwork = useCallback(
    async (files: readonly File[]): Promise<ArtworkImportResult> => {
      const project = state.project;

      if (project === null) {
        return { imported: [], errors: ['No project is loaded.'] };
      }

      if (state.saving) {
        return {
          imported: [],
          errors: ['Another save is in progress. Try again in a moment.'],
        };
      }

      const importedById = new Map<string, AssetReference>();
      const errors: string[] = [];

      for (const file of files) {
        if (file.type.length > 0 && !file.type.startsWith('image/')) {
          errors.push(`${file.name}: only image files are supported.`);
          continue;
        }

        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const assetId = await computeSha256Hex(bytes);
          const reference: AssetReference = {
            assetId,
            fileName: file.name,
            ...(file.webkitRelativePath.length === 0
              ? {}
              : { relativePathHint: file.webkitRelativePath }),
            mimeType: file.type || 'application/octet-stream',
            byteSize: bytes.byteLength,
          };
          const stored = await saveVerifiedAsset(reference, bytes);

          if (!stored.ok) {
            errors.push(
              `${file.name}: ${stored.issues[0]?.message ?? 'verification failed.'}`,
            );
            continue;
          }

          const existing = project.assets.find(
            (asset) => asset.assetId === assetId,
          );
          importedById.set(assetId, existing ?? stored.value);
        } catch (error) {
          errors.push(`${file.name}: ${toErrorMessage(error)}`);
        }
      }

      const imported = [...importedById.values()];

      if (imported.length === 0) {
        return { imported: [], errors };
      }

      const saved = await persistProject(
        upsertProjectAssets(project, imported),
        'Artwork could not be saved to the project.',
      );

      return saved
        ? { imported, errors }
        : {
            imported: [],
            errors: [
              ...errors,
              'The imported artwork could not be attached to the saved project.',
            ],
          };
    },
    [state, persistProject],
  );

  const importProject = useCallback(
    async (
      manifest: ProjectManifest,
      policy: ProjectImportPolicy,
      assetBytes: ReadonlyMap<string, Uint8Array>,
    ): Promise<boolean> => {
      if (state.saving) {
        return false;
      }

      const strict = validateProjectManifest(manifest);

      if (!strict.ok) {
        setState((current) => ({
          ...current,
          saveIssues: strict.issues,
          saveErrorMessage: 'Imported project failed strict validation.',
        }));
        return false;
      }

      const incoming = strict.value;
      const currentProject = state.project;

      if (
        policy === 'merge' &&
        currentProject !== null &&
        currentProject.profile.id !== incoming.profile.id
      ) {
        setState((current) => ({
          ...current,
          saveErrorMessage:
            'Projects with different profile ids cannot be merged. Use Replace project instead.',
        }));
        return false;
      }

      const assetsById = new Map(
        incoming.assets.map((asset) => [asset.assetId, asset]),
      );

      for (const [assetId, bytes] of assetBytes) {
        const reference = assetsById.get(assetId);

        if (reference === undefined) {
          continue;
        }

        const stored = await saveVerifiedAsset(reference, bytes);

        if (!stored.ok) {
          setState((current) => ({
            ...current,
            saveIssues: stored.issues,
            saveErrorMessage:
              'Imported artwork failed verification and was not accepted.',
          }));
          return false;
        }
      }

      const nextProject =
        policy === 'merge' && currentProject !== null
          ? mergeProjectManifests(currentProject, incoming)
          : {
              ...incoming,
              updatedAt: new Date().toISOString(),
            };
      const validation = validateStoredProject(nextProject);

      if (!validation.ok) {
        setState((current) => ({
          ...current,
          saveIssues: validation.issues,
          saveErrorMessage: 'Imported project is not compatible with this app.',
        }));
        return false;
      }

      const operationGeneration = generation.current;

      setState((current) => ({
        ...current,
        saving: true,
        saveIssues: [],
        saveErrorMessage: null,
      }));

      try {
        await saveStoredProject(validation.value);

        if (generation.current !== operationGeneration) {
          return false;
        }

        const savedAt = new Date().toISOString();

        setState((current) =>
          generation.current !== operationGeneration
            ? current
            : {
                ...current,
                saving: false,
                project: validation.value,
                profileDraft: structuredClone(validation.value.profile),
                profileSavedAt: savedAt,
                savedAt,
                saveIssues: [],
                saveErrorMessage: null,
              },
        );
        return true;
      } catch (error) {
        if (generation.current !== operationGeneration) {
          return false;
        }

        setState((current) => ({
          ...current,
          saving: false,
          saveErrorMessage: toErrorMessage(error),
        }));
        return false;
      }
    },
    [state],
  );

  const deleteTemplate = useCallback(
    async (templateId: string): Promise<boolean> => {
      const project = state.project;
      if (project === null || state.saving) {
        return false;
      }

      if (project.templates.length <= 1) {
        setState((current) => ({
          ...current,
          saveErrorMessage: 'A project must keep at least one template.',
        }));
        return false;
      }

      const usageCount = project.cards.filter(
        (card) => card.templateId === templateId,
      ).length;

      if (usageCount > 0) {
        setState((current) => ({
          ...current,
          saveErrorMessage: `Template is used by ${usageCount} card${
            usageCount === 1 ? '' : 's'
          }. Reassign those cards first.`,
        }));
        return false;
      }

      return persistProject(
        removeProjectTemplate(project, templateId),
        'Template could not be deleted.',
      );
    },
    [state, persistProject],
  );

  const resetProject = useCallback(async (): Promise<void> => {
    const operationGeneration = ++generation.current;

    setState((current) => ({
      ...current,
      saving: true,
      loadErrorMessage: null,
      loadIssues: [],
      saveIssues: [],
      saveErrorMessage: null,
    }));

    try {
      await clearStoredProject();
      if (generation.current !== operationGeneration) {
        return;
      }

      setState({
        ...INITIAL_STATE,
        status: 'ready',
        profileDraft: createBlankGameProfile(),
      });
    } catch (error) {
      if (generation.current !== operationGeneration) {
        return;
      }

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
    updateProfileDraft,
    saveProfile,
    discardProfileDraft,
    saveCard,
    deleteCard,
    clearCards,
    importArtwork,
    importProject,
    savePack,
    deletePack,
    saveDeck,
    deleteDeck,
    saveTemplate,
    deleteTemplate,
    reload: load,
    resetProject,
  };
}
