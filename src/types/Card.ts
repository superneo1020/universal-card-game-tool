// ==========================================
// LAYER 2: CARD TEMPLATES (BLOCK COMPOSITIONS)
// ==========================================

export type BlockType = 
  | 'header'       // Card name, type line, and mana/cost badges
  | 'art_box'      // Content-hashed image container (`artAssetId`)
  | 'textbox'      // Formatted rules text with keyword highlighting
  | 'stat_badge'   // Attack/Defense or resource metrics
  | 'splitter'     // Visual divider line
  | 'tag_list'     // Pill badges for card subtypes or tags
  | 'structured_list'; // Configured repeating values such as costs

/**
 * Finite identifiers for the statically declared Tailwind design-token map.
 *
 * Persist these identifiers instead of Tailwind class strings so the renderer
 * can resolve them through a whitelisted class map that Vite can statically
 * discover. Raw utility classes are rejected by runtime validation.
 */
export type DesignTokenId =
  | 'header.primary'
  | 'header.secondary'
  | 'art.default'
  | 'art.fullBleed'
  | 'textbox.body'
  | 'textbox.flavor'
  | 'textbox.rules'
  | 'stat.primary'
  | 'stat.secondary'
  | 'splitter.default'
  | 'splitter.strong'
  | 'tag.neutral'
  | 'tag.accent'
  | 'tag.muted'
  | 'structured.default'
  | 'structured.compact';

export interface TemplateBlock {
  id: string;
  type: BlockType;
  designTokenStyle: DesignTokenId; // Whitelisted token ID, never a raw class string
  mappingKey?: string;             // Binds block to a FieldDefinition or core property
  hideWhenEmpty?: boolean;         // Omit the block when its mapped value is empty
  order: number;
}

export interface CardTemplate {
  id: string;
  profileId: string;
  name: string;              // e.g., "Standard Creature Template"
  layout: 'single' | 'double_sided' | 'split';
  blocks: TemplateBlock[];
}