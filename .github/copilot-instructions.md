# Developer Card-Design Tool: System Architecture & Engineering Rules (v2)

## 1. Core Architectural Principle
Keep card data, game rules, and visual rendering strictly decoupled. A card’s structured data drives search, categorization, validation, and serialization; its template controls visual presentation via bounded design tokens.

**The Golden Rule:** The application's internal data model must remain strictly structured and compile-time type-safe, while each specific game's card fields, stats, and visual layouts are dynamically configured at runtime.

---

## 2. Product Architecture (4-Layer Runtime-Configurable System)
Do not hardcode game-specific fields. Model the application cleanly across four distinct layers:

- **Layer 1: Game Profile:** Defines runtime-configurable fields, validation rules, card types, and subtypes. Supported field types are driven by an explicit discriminated union:
  `type FieldType = { type: 'text' } | { type: 'number' } | { type: 'boolean' } | { type: 'enum'; options: string[] } | { type: 'list'; itemType: 'text' | 'number' };`. Keep variants uniformly discriminated so exhaustive `switch` handling is possible. Runtime validation must ensure each value and default matches its field definition.
  Includes declarative deck-building rules (`minSize`, `maxSize`, `maxCopiesPerCard`) that produce soft UI warnings only in v1; do not block editing or claim rules-engine legality.
- **Layer 2: Card Templates (Block Compositions):** Users design cards by arranging and re-ordering a predefined, finite set of structural UI blocks (e.g., `header`, `art_box`, `textbox`, `stat_badge`, `splitter`, `tag_list`) mapped directly to fixed Tailwind Design Tokens. No arbitrary JSX/CSS string execution or insertion is allowed.
- **Layer 3: Card Records & Faces:** Concrete instances supporting single, double-faced, or multi-face layouts. Stores runtime lookup tables for root and face attributes, mapping artwork exclusively via content-hashed local asset IDs (`artAssetId`), never raw filenames or volatile relative paths.
- **Layer 4: Collections, Packs & Decks (v1 Scope):**
  - *Packs:* Manually curated static collections of card IDs. Randomized booster/loot-table generation is deferred to v2.
  - *Decks:* Store card IDs and quantities as `DeckEntry[]`.
  - *Tags & collections:* Card and deck tags power search, filtering, and dynamic group views. Tags are not a substitute for pack membership or deck quantities; do not introduce a separate persisted collection model unless a feature requires saved custom groups.

---

## 3. Technical Constraints & Permitted Dependencies (Pure Frontend)
- **Hosting & Runtime:** 100% Static SPA using React + Vite. Fully functional without backends, remote services, or remote APIs; use browser-native APIs where specified.
- **Storage Footprint:** Store project metadata and heavy local image bytes directly in the browser's native **IndexedDB API** (no wrappers). Local storage is browser/device-specific and is not a backup.
- **Compression Rule Separation:**
  - Use native browser **`CompressionStream('gzip')`** and **`DecompressionStream('gzip')`** for URL-first snapshot generation. If unavailable, trigger an explicit export fallback.
  - **`fflate`** is the only permitted additional runtime dependency and is reserved for ZIP packaging: optional project asset archives and rendered review bundles. Do not use it as a gzip fallback.
- **Asset Ingestion:** Prefer the native File System Access API (`showDirectoryPicker`) where available and invoked by a user gesture. Support folder drag-and-drop and `<input type="file" webkitdirectory multiple>` as progressive-enhancement options where the browser supports them; these directory APIs are not universal. If folder selection is unavailable, allow explicit multiple-file selection and explain the limitation.
  Compute `artAssetId` as a SHA-256 digest of image bytes using native Web Crypto. Filenames or relative paths may be stored only as optional relinking hints, never as identity. A JSON-only export contains metadata and asset references, not image bytes. A complete portable backup consists of the versioned JSON manifest and its matching ZIP asset archive; label a JSON-only export as metadata-only. Show a distinct missing-art placeholder and allow re-import/relinking by content hash.

---

## 4. Multi-Role Collaboration & Secure Pipelines (Designer ⇄ UI Artist)
- **Dual-Track Sharing & Guardrails:**
  1. **Master Copy (File-First):** Project data and state transfers use a versioned `.json` manifest (`ProjectManifest`). Custom runtime TypeScript Type Guards must rigorously validate imported JSON payloads before updating state.
     The JSON manifest carries project data and asset references; include image bytes only in an associated ZIP asset archive, never as base64 in JSON. Validate imported data from `unknown`, migrate supported older schema versions, check references and field-value compatibility, and resolve ID conflicts through an explicit import preview/policy before applying changes atomically. Do not reject legitimate same-project IDs without offering an intentional replace/merge path.
  2. **Snapshot Preview (URL-First):** Share links are text-only, image-free snapshots optimized for the active viewport. Use native gzip streams and measure the final encoded URL; if it exceeds 2048 characters or compression is unavailable, offer JSON export instead. Do not include image bytes in URLs.
- **Review Zip Production:** Use a dedicated deterministic SVG or canvas renderer for supported card blocks; React DOM components cannot be drawn directly onto a canvas. Render high-resolution `.png`/`.jpeg` outputs entirely in the browser, then use `fflate` to package review images into a ZIP. Keep this separate from the project-data and asset-archive formats.

---

## 5. Coding & Styling Standards
- **Strict TypeScript React:** **Zero `any`.** Enforce strict interface props, handle versioned migration types for JSON mutations, and use exhaustive switch-cases for rendering dynamic `FieldType` and template blocks. TypeScript types do not validate runtime-configured schemas or imported JSON: validate at runtime and keep untrusted input typed as `unknown` until checked. Treat current types as evolving implementation details; update them alongside the versioned manifest and migrations rather than preserving an early shape for compatibility.
- **Compile-Time Tailwind Preservation:** Persist finite design-token identifiers, not arbitrary Tailwind class strings. Resolve identifiers through statically declared, whitelisted class maps so Vite can discover every class; never generate class names from user data. Ensure Tailwind is installed and configured before relying on its utilities.