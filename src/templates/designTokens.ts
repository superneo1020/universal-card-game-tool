import type { DesignTokenId } from '../types/Card';

/**
 * Statically declared token-to-class map. Persisted templates store only the
 * token id; renderers resolve it through this finite map so every class is
 * discoverable at build time and arbitrary class strings never reach the DOM.
 */
export const DESIGN_TOKEN_CLASS_NAMES: Readonly<
  Record<DesignTokenId, string>
> = {
  'header.primary': 'token-header-primary',
  'header.secondary': 'token-header-secondary',
  'art.default': 'token-art-default',
  'art.fullBleed': 'token-art-full-bleed',
  'textbox.body': 'token-textbox-body',
  'textbox.flavor': 'token-textbox-flavor',
  'textbox.rules': 'token-textbox-rules',
  'stat.primary': 'token-stat-primary',
  'stat.secondary': 'token-stat-secondary',
  'splitter.default': 'token-splitter-default',
  'splitter.strong': 'token-splitter-strong',
  'tag.neutral': 'token-tag-neutral',
  'tag.accent': 'token-tag-accent',
  'tag.muted': 'token-tag-muted',
  'structured.default': 'token-structured-default',
  'structured.compact': 'token-structured-compact',
};
