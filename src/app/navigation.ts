/**
 * Typed navigation model for the application shell.
 *
 * Keeping section metadata here (rather than inline in JSX) makes the shell
 * predictable and lets us regression-test navigation completeness without a
 * DOM harness.
 */

export type SectionId =
  | 'cards'
  | 'templates'
  | 'packs'
  | 'decks'
  | 'settings';

export interface ProjectCounts {
  readonly cards: number;
  readonly templates: number;
  readonly packs: number;
  readonly decks: number;
}

export interface SectionDefinition {
  readonly id: SectionId;
  readonly label: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly iconPaths: readonly string[];
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly actionLabel?: string;
  readonly countKey?: keyof ProjectCounts;
  readonly checklist?: readonly string[];
}

export const DEFAULT_SECTION_ID: SectionId = 'cards';

/** Display order for the primary workspace navigation. */
export const SECTION_ORDER: readonly SectionId[] = [
  'cards',
  'templates',
  'packs',
  'decks',
  'settings',
];

/**
 * Exhaustive section registry. The `Record<SectionId, ...>` annotation turns a
 * missing or misspelled section into a compile-time error.
 */
const SECTION_REGISTRY: Readonly<Record<SectionId, SectionDefinition>> = {
  cards: {
    id: 'cards',
    label: 'Cards',
    eyebrow: 'Card library',
    description: 'Browse, filter, and edit cards in the active game.',
    iconPaths: [
      'M7 3.5h9.5A2.5 2.5 0 0 1 19 6v11.5',
      'M4.5 6.5h9A2.5 2.5 0 0 1 16 9v11H7A2.5 2.5 0 0 1 4.5 17.5z',
    ],
    emptyTitle: 'Your card library is empty',
    emptyDescription:
      'Cards are generated from your game profile. Define fields once, then every card form stays in sync with the schema.',
    actionLabel: 'Create first card',
    countKey: 'cards',
  },
  templates: {
    id: 'templates',
    label: 'Templates',
    eyebrow: 'Card layout',
    description: 'Compose card blocks and bind them to profile fields.',
    iconPaths: [
      'M4 5.5h10A2.5 2.5 0 0 1 16.5 8v11H7A3 3 0 0 1 4 16V5.5Z',
      'M8 3.5h8A4 4 0 0 1 20 7.5v9',
    ],
    emptyTitle: 'No card templates yet',
    emptyDescription:
      'Templates arrange header, artwork, text, stats, splitters, and tag blocks. Every project starts with a standard single-face template.',
    actionLabel: 'Create template',
    countKey: 'templates',
  },
  packs: {
    id: 'packs',
    label: 'Packs',
    eyebrow: 'Curation',
    description: 'Group cards into fixed, intentional releases.',
    iconPaths: [
      'M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z',
      'M4 8.5 12 13l8-4.5',
      'M12 13v7',
    ],
    emptyTitle: 'No packs curated yet',
    emptyDescription:
      'Packs are manually curated card sets for starters and releases. Randomized boosters are intentionally deferred to a later version.',
    actionLabel: 'Create pack',
    countKey: 'packs',
  },
  decks: {
    id: 'decks',
    label: 'Decks',
    eyebrow: 'Deckbuilding',
    description: 'Assemble decklists with quantities and soft rule checks.',
    iconPaths: ['M12 3 3 8l9 5 9-5-9-5Z', 'M3 12l9 5 9-5', 'M3 16l9 5 9-5'],
    emptyTitle: 'No decks assembled yet',
    emptyDescription:
      'Decklists reference cards in the library with explicit quantities. Deck-size and copy limits appear as soft warnings, never hard blocks.',
    actionLabel: 'Create deck',
    countKey: 'decks',
  },
  settings: {
    id: 'settings',
    label: 'Game settings',
    eyebrow: 'Game profile',
    description: 'Define the runtime schema that powers card forms and validation.',
    iconPaths: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M14 4v6', 'M8 14v6'],
    emptyTitle: 'Game profile not configured',
    emptyDescription:
      'The game profile is the single source of truth for field definitions, card types, and deck rules. Configure it before creating cards.',
    checklist: [
      'Field definitions & defaults',
      'Card types, subtypes & keywords',
      'Deck-building soft limits',
    ],
  },
};

/** Ordered section list consumed by the sidebar. */
export const SECTIONS: readonly SectionDefinition[] = SECTION_ORDER.map(
  (id) => SECTION_REGISTRY[id],
);

/** Looks up a section definition by its typed id. */
export function getSection(id: SectionId): SectionDefinition {
  return SECTION_REGISTRY[id];
}
