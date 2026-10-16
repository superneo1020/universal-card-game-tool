// ==========================================
// LAYER 4: COLLECTIONS, PACKS & DECKS (V1 SCOPE)
// ==========================================

export interface CardPack {
  id: string;
  name: string;              // Manually curated collection name (e.g., "Starter Set Release")
  description: string;
  cardIds: string[];         // Explicit references to CardRecord IDs included in this curation
  releaseDate?: string;
}

export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface Deck {
  id: string;
  profileId: string;
  name: string;
  format: string;            // e.g., "Standard", "Commander"
  entries: DeckEntry[];      // Card ID and quantity mapping
  tags: string[];            // Deck classification tags
}