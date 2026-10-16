// ==========================================
// LAYER 2: CARD TEMPLATES (BLOCK COMPOSITIONS)
// ==========================================

export type BlockType = 
  | 'header'       // Card name, type line, and mana/cost badges
  | 'art_box'      // Content-hashed image container (`artAssetId`)
  | 'textbox'      // Formatted rules text with keyword highlighting
  | 'stat_badge'   // Attack/Defense or resource metrics
  | 'splitter'     // Visual divider line
  | 'tag_list';    // Pill badges for card subtypes or tags

export interface TemplateBlock {
  id: string;
  type: BlockType;
  designTokenStyle: string;  // Mapped Tailwind utility token class (e.g., "bg-amber-900/10 border-amber-800")
  mappingKey?: string;       // Binds block to a specific FieldDefinition or core property
  order: number;
}

export interface CardTemplate {
  id: string;
  profileId: string;
  name: string;              // e.g., "Standard Creature Template"
  layout: 'single' | 'double_sided' | 'split';
  blocks: TemplateBlock[];
}