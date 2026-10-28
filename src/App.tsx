import { useEffect, useState } from 'react';

import {
  DEFAULT_SECTION_ID,
  SECTIONS,
  getSection,
  type ProjectCounts,
  type SectionId,
} from './app/navigation';
import { CardLibrary } from './components/cards/CardLibrary';
import { DeckLibrary } from './components/decks/DeckLibrary';
import { EmptyState } from './components/EmptyState';
import { GameProfileEditor } from './components/GameProfileEditor';
import { PackLibrary } from './components/packs/PackLibrary';
import { ProjectFilesPanel } from './components/ProjectFilesPanel';
import { SectionIcon } from './components/SectionIcon';
import { TemplateLibrary } from './components/templates/TemplateLibrary';
import type { UseCardLibraryResult } from './hooks/useCardLibrary';
import { useProject } from './hooks/useProject';
import {
  isProfileDraftDirty,
  isProfileReady,
} from './profile/profileFactory';
import type { GameProfile } from './types/Game';
import { CURRENT_SCHEMA_VERSION } from './types/ProjectManifest';
import type { ValidationIssue } from './utils/validation';
import './App.css';

const DEFAULT_PROJECT_NAME = 'Untitled Project';

/** Architecture layer badge for each workspace section. */
const LAYER_LABELS: Readonly<Record<SectionId, number>> = {
  cards: 3,
  templates: 2,
  packs: 4,
  decks: 4,
  settings: 1,
};

const STORAGE_ICON_PATHS = [
  'M12 3 5 6v5c0 4.3 2.9 7.7 7 9 4.1-1.3 7-4.7 7-9V6l-7-3Z',
  'M9.5 12l1.8 1.8 3.4-3.6',
];

function describeProfile(
  profile: GameProfile | null,
  status: 'loading' | 'ready' | 'error',
): string {
  if (status === 'loading') {
    return 'Loading local game profile…';
  }

  if (status === 'error') {
    return 'Local profile unavailable';
  }

  if (profile === null) {
    return 'No game profile attached yet';
  }

  const cardTypeCount = profile.cardTypes.length;
  const fieldCount = profile.fieldDefinitions.length;

  return `${profile.name} · ${cardTypeCount} card type${
    cardTypeCount === 1 ? '' : 's'
  } · ${fieldCount} field${fieldCount === 1 ? '' : 's'}`;
}

function summarizeIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) {
    return 'The stored profile could not be validated.';
  }

  const preview = issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(' ');

  return issues.length > 3
    ? `${preview} (+${issues.length - 3} more)`
    : preview;
}

function App() {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>(
    DEFAULT_SECTION_ID,
  );
  const [navVisible, setNavVisible] = useState(true);
  const activeSection = getSection(activeSectionId);
  const {
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
    reload,
    resetProject,
  } = useProject();

  const profile = state.project?.profile ?? null;
  const projectName = state.project?.projectName ?? DEFAULT_PROJECT_NAME;
  const profileReady = isProfileReady(profile);
  const hasUnsavedChanges = isProfileDraftDirty(
    profile,
    state.profileDraft,
  );
  const unsavedLabel = profile === null ? 'Not saved' : 'Unsaved changes';
  const unsavedTopbarLabel =
    profile === null ? 'Not saved' : 'Unsaved profile';
  const projectCounts: ProjectCounts = {
    cards: state.project?.cards.length ?? 0,
    templates: state.project?.templates.length ?? 0,
    packs: state.project?.packs.length ?? 0,
    decks: state.project?.decks.length ?? 0,
  };
  const cardLibrary: UseCardLibraryResult = {
    state: {
      status: state.status,
      profileId: profile?.id ?? null,
      cards: state.project?.cards ?? [],
      loadErrorMessage: state.loadErrorMessage,
      loadIssues: state.loadIssues,
      saving: state.saving,
      saveErrorMessage: state.saveErrorMessage,
      savedAt: state.savedAt,
    },
    saveCard,
    deleteCard,
    clearLibrary: clearCards,
    reload,
  };

  useEffect(() => {
    document.title = `${activeSection.label} · Card Studio`;
  }, [activeSection.label]);

  function renderLoadingProfile() {
    return (
      <div className="profile-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Loading your local game profile…</p>
      </div>
    );
  }

  function renderActiveSection() {
    if (activeSection.id === 'settings') {
      if (
        state.status === 'loading' ||
        (state.status === 'ready' && state.profileDraft === null)
      ) {
        return renderLoadingProfile();
      }

      if (state.status === 'error') {
        const hasInvalidStoredProject = state.loadIssues.length > 0;

        return (
          <EmptyState
            icon={<SectionIcon paths={activeSection.iconPaths} />}
            title={
              hasInvalidStoredProject
                ? 'Stored project is invalid'
                : 'Could not load the local project'
            }
            description={
              hasInvalidStoredProject
                ? summarizeIssues(state.loadIssues)
                : (state.loadErrorMessage ??
                  'The local storage layer returned an unknown error.')
            }
            actionLabel={
              hasInvalidStoredProject ? 'Reset stored project' : 'Retry loading'
            }
            onAction={
              hasInvalidStoredProject
                ? () => {
                    void resetProject();
                  }
                : reload
            }
            actionNote={
              hasInvalidStoredProject
                ? 'This removes the saved project from this browser.'
                : undefined
            }
          />
        );
      }

      if (state.profileDraft !== null) {
        return (
          <div className="settings-stack">
            <GameProfileEditor
              draft={state.profileDraft}
              persistedProfile={profile}
              saving={state.saving}
              savedAt={state.profileSavedAt}
              storageError={state.saveErrorMessage}
              onUpdate={updateProfileDraft}
              onSave={() => {
                void saveProfile();
              }}
              onDiscard={discardProfileDraft}
            />
            <ProjectFilesPanel
              project={state.project}
              saving={state.saving}
              saveErrorMessage={state.saveErrorMessage}
              saveIssues={state.saveIssues}
              unsavedProfileChanges={hasUnsavedChanges}
              onImport={importProject}
            />
          </div>
        );
      }

      return renderLoadingProfile();
    }

    if (state.status === 'loading') {
      return renderLoadingProfile();
    }

    if (state.status === 'error') {
      const hasInvalidStoredProject = state.loadIssues.length > 0;

      return (
        <EmptyState
          icon={<SectionIcon paths={activeSection.iconPaths} />}
          title={
            hasInvalidStoredProject
              ? 'Stored project is invalid'
              : 'Could not load the local project'
          }
          description={
            hasInvalidStoredProject
              ? summarizeIssues(state.loadIssues)
              : (state.loadErrorMessage ??
                'The local storage layer returned an unknown error.')
          }
          actionLabel={
            hasInvalidStoredProject ? 'Reset stored project' : 'Retry loading'
          }
          onAction={
            hasInvalidStoredProject
              ? () => {
                  void resetProject();
                }
              : reload
          }
          actionNote={
            hasInvalidStoredProject
              ? 'This removes the saved project from this browser.'
              : undefined
          }
        />
      );
    }

    const project = state.project;

    if (project === null || profile === null || !profileReady) {
      const missingProfile = profile === null;
      const setupDescription =
        activeSection.id === 'templates'
          ? 'Templates arrange structural blocks and bind them to profile fields. Configure the game profile before composing layouts.'
          : activeSection.id === 'packs'
            ? 'Packs curate cards from the library. Configure the game profile and create cards before curating releases.'
            : activeSection.id === 'decks'
              ? 'Decks assemble cards from the library with explicit quantities. Configure the game profile before deckbuilding.'
              : 'Cards are generated from the game profile. Define card types, typed fields, and deck rules before building the library.';

      return (
        <EmptyState
          icon={<SectionIcon paths={activeSection.iconPaths} />}
          title={
            missingProfile
              ? 'Configure your game profile first'
              : 'Add a card type to finish setup'
          }
          description={
            missingProfile
              ? setupDescription
              : 'Your profile is saved, but it needs at least one card type before this section can work.'
          }
          actionLabel="Open game settings"
          onAction={() => setActiveSectionId('settings')}
        />
      );
    }

    switch (activeSection.id) {
      case 'cards':
        return (
          <CardLibrary
            profile={profile}
            library={cardLibrary}
            assets={project.assets}
            templates={project.templates}
            packs={project.packs}
            onImportArtwork={importArtwork}
          />
        );

      case 'templates':
        return (
          <TemplateLibrary
            project={project}
            saving={state.saving}
            saveErrorMessage={state.saveErrorMessage}
            saveIssues={state.saveIssues}
            onSave={saveTemplate}
            onDelete={deleteTemplate}
          />
        );

      case 'packs':
        return (
          <PackLibrary
            project={project}
            profile={profile}
            assets={project.assets}
            templates={project.templates}
            saving={state.saving}
            saveErrorMessage={state.saveErrorMessage}
            saveIssues={state.saveIssues}
            onSave={savePack}
            onDelete={deletePack}
          />
        );

      case 'decks':
        return (
          <DeckLibrary
            profile={profile}
            cards={project.cards}
            decks={project.decks}
            assets={project.assets}
            templates={project.templates}
            saving={state.saving}
            saveErrorMessage={state.saveErrorMessage}
            saveIssues={state.saveIssues}
            onSave={saveDeck}
            onDelete={deleteDeck}
          />
        );
    }
  }

  return (
    <div
      className={`app-shell${navVisible ? '' : ' app-shell--nav-collapsed'}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>

      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <SectionIcon paths={getSection('cards').iconPaths} />
          </span>
          <span className="brand__text">
            <span className="brand__name">Card Studio</span>
            <span className="brand__tagline">Universal card game designer</span>
          </span>
        </div>

        <nav className="topbar__trail" aria-label="Breadcrumb">
          <ol className="breadcrumb">
            <li>Workspace</li>
            <li aria-current="page">
              <span className="breadcrumb__separator" aria-hidden="true">
                /
              </span>
              {projectName}
            </li>
          </ol>
        </nav>

        <div className="topbar__status">
          <button
            type="button"
            className="button button--ghost topbar__nav-toggle"
            aria-pressed={navVisible}
            onClick={() => setNavVisible((current) => !current)}
          >
            {navVisible ? 'Hide design list' : 'Show design list'}
          </button>
          <span className="pill pill--local">
            <span className="status-dot status-dot--local" aria-hidden="true" />
            Local-only
          </span>
          <span className="pill pill--muted">
            {state.status === 'loading'
              ? 'Loading profile'
              : state.status === 'error'
                ? 'Profile error'
                : hasUnsavedChanges
                  ? unsavedTopbarLabel
                  : profileReady
                    ? 'Profile ready'
                    : profile === null
                      ? 'No profile'
                      : 'Profile saved'}
          </span>
        </div>
      </header>

      <aside className="sidebar">        <div className="sidebar__inner">
          <div>
            <p className="sidebar__label">Design</p>
            <nav className="nav-list" aria-label="Project sections">
              {SECTIONS.map((section) => {
                const isActive = section.id === activeSectionId;
                const count =
                  section.countKey === undefined
                    ? null
                    : projectCounts[section.countKey];

                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setActiveSectionId(section.id)}
                  >
                    <span className="nav-item__icon" aria-hidden="true">
                      <SectionIcon paths={section.iconPaths} />
                    </span>
                    <span className="nav-item__copy">
                      <span className="nav-item__label">{section.label}</span>
                      <span className="nav-item__description">
                        {section.description}
                      </span>
                    </span>
                    {count === null ? null : (
                      <span className="nav-item__count">{count}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="sidebar__note">
            <span className="sidebar__note-icon" aria-hidden="true">
              <SectionIcon paths={STORAGE_ICON_PATHS} />
            </span>
            <div>
              <p className="sidebar__note-title">Local-first by design</p>
              <p className="sidebar__note-body">
                Project metadata and artwork stay in this browser. No account or
                server required.
              </p>
            </div>
          </div>

          <div className="sidebar__footer">
            <span>Schema v{CURRENT_SCHEMA_VERSION}</span>
            <span>
              {state.status === 'error'
                ? 'Storage error'
                : hasUnsavedChanges
                  ? unsavedLabel
                  : profile === null
                    ? 'Local draft'
                    : 'Profile saved'}
            </span>
          </div>
        </div>
      </aside>

      <main className="workspace" id="main-content" tabIndex={-1}>
        <div className="content-stack">
          <section className="project-hero" aria-labelledby="project-name">
            <div className="project-hero__identity">
              <span className="project-mark" aria-hidden="true">
                U
              </span>
              <div>
                <p className="eyebrow">Current design</p>
                <h1 id="project-name">{projectName}</h1>
                <p className="project-hero__subtitle">
                  {describeProfile(profile, state.status)}
                </p>
              </div>
            </div>

            <div className="project-hero__meta">
              <span
                className={`pill ${
                  state.status === 'error'
                    ? 'pill--error'
                    : hasUnsavedChanges
                      ? 'pill--draft'
                      : profileReady
                        ? 'pill--local'
                        : 'pill--draft'
                }`}
              >
                <span
                  className={`status-dot ${
                    state.status === 'error'
                      ? 'status-dot--error'
                      : hasUnsavedChanges || !profileReady
                        ? 'status-dot--draft'
                        : ''
                  }`}
                  aria-hidden="true"
                />
                {state.status === 'loading'
                  ? 'Loading'
                  : state.status === 'error'
                    ? 'Storage error'
                    : hasUnsavedChanges
                      ? unsavedLabel
                      : profileReady
                        ? 'Profile ready'
                        : profile === null
                          ? 'Draft'
                          : 'Profile saved'}
              </span>
            </div>
          </section>

          <section
            key={activeSection.id}
            className="section-panel"
            aria-labelledby="section-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">{activeSection.eyebrow}</p>
                <h2 id="section-title">{activeSection.label}</h2>
                <p>{activeSection.description}</p>
              </div>
              <span className="section-badge">
                Layer {LAYER_LABELS[activeSection.id]}
              </span>
            </div>

            {renderActiveSection()}
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
