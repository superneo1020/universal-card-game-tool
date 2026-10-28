import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SECTION_ID,
  SECTIONS,
  SECTION_ORDER,
  getSection,
} from './navigation';

describe('application shell navigation', () => {
  it('exposes every section in the declared order', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(SECTION_ORDER);
  });

  it('resolves every typed section id', () => {
    for (const id of SECTION_ORDER) {
      expect(getSection(id).id).toBe(id);
    }
  });

  it('uses unique section ids', () => {
    expect(new Set(SECTION_ORDER).size).toBe(SECTION_ORDER.length);
  });

  it('provides complete empty-state content for every section', () => {
    for (const section of SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.eyebrow.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
      expect(section.emptyTitle.length).toBeGreaterThan(0);
      expect(section.emptyDescription.length).toBeGreaterThan(0);
      expect(section.iconPaths.length).toBeGreaterThan(0);
    }
  });

  it('maps countable sections to project counts', () => {
    expect(getSection('cards').countKey).toBe('cards');
    expect(getSection('templates').countKey).toBe('templates');
    expect(getSection('packs').countKey).toBe('packs');
    expect(getSection('decks').countKey).toBe('decks');
    expect(getSection('settings').countKey).toBeUndefined();
  });

  it('uses a checklist instead of an editor action for the game profile', () => {
    const settings = getSection('settings');

    expect(settings.actionLabel).toBeUndefined();
    expect(settings.checklist?.length).toBeGreaterThan(0);
  });

  it('starts on the card library', () => {
    expect(DEFAULT_SECTION_ID).toBe('cards');
    expect(getSection(DEFAULT_SECTION_ID).id).toBe('cards');
  });
});
