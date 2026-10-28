# Developer Card-Design Tool: Product, Architecture & UI Rules (v3)

## 1. Core Product Principle
Keep card data, game rules, and visual rendering strictly decoupled. Structured card data drives search, categorization, validation, and serialization; templates control visual presentation through a finite set of supported blocks and design tokens.

**The Golden Rule:** Keep internal models compile-time type-safe while allowing each game's fields, stats, and visual layouts to be configured at runtime. Never implement an individual game's mechanics as hardcoded application logic when they can be expressed through the configured schema.

---

## 2. Product Architecture (4-Layer Runtime-Configurable System)
Do not hardcode game-specific fields. Model the application cleanly across four distinct layers:

- **Layer 1: Game Profile:** Defines card types, subtypes, keywords, runtime-configurable fields, and validation rules. Use a uniformly discriminated `FieldType` union, including text, number, boolean, enum, scalar list, and structured repeating entries. Structured child fields may nest up to `MAX_STRUCTURED_DEPTH` (currently 3). Runtime validation must ensure every value and default matches its field definition, target, and applicable card type. Fields may target the card root or an individual face. Deck rules (`minSize`, `maxSize`, `maxCopiesPerCard`) produce soft warnings in v1; never block edits or claim rules-engine legality.
- **Layer 2: Card Templates (Block Compositions):** Users arrange and reorder a finite set of supported blocks: `header`, `art_box`, `textbox`, `stat_badge`, `splitter`, `tag_list`, and `structured_list`. Blocks map to finite, statically declared design-token IDs; resolve IDs through a whitelist. Do not execute arbitrary JSX, CSS, class strings, or user-provided code.
- **Layer 3: Card Records & Faces:** Cards support one or multiple faces, with face-level identity overrides and root/face attribute maps. `artAssetId` references art placed inside a generated template; `fullCardAssetId` references a completed-card scan that replaces the generated preview. Both IDs must reference verified, content-hashed local assets. Filenames and relative paths may be optional relinking hints only, never asset identity.
- **Layer 4: Collections, Packs & Decks (v1 Scope):**
  - *Packs:* Manually curated static collections of card IDs. Randomized booster/loot-table generation is deferred to v2.
  - *Decks:* Store card IDs and quantities as `DeckEntry[]`.
  - *Tags & collections:* Card and deck tags power search, filtering, and dynamic group views. Tags are not a substitute for pack membership or deck quantities; do not introduce a separate persisted collection model unless a feature requires saved custom groups.
- A project currently contains one game profile. Keep project identity distinct from profile identity; do not present a multi-project or multi-profile switcher unless it is implemented.

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

## 4. Import, Sharing & Review Pipelines
- **Dual-Track Sharing & Guardrails:**
  1. **Master Copy (File-First):** Project data and state transfers use a versioned `.json` manifest (`ProjectManifest`). Custom runtime TypeScript Type Guards must rigorously validate imported JSON payloads before updating state.
     The JSON manifest carries project data and asset references; include image bytes only in an associated ZIP asset archive, never as base64 in JSON. Validate imported data from `unknown`, migrate supported older schema versions, check references and field-value compatibility, and resolve ID conflicts through an explicit import preview/policy before applying changes atomically. Do not reject legitimate same-project IDs without offering an intentional replace/merge path.
  2. **Snapshot Preview (URL-First):** Share links are text-only, image-free snapshots optimized for the active viewport. Use native gzip streams and measure the final encoded URL; if it exceeds 2048 characters or compression is unavailable, offer JSON export instead. Do not include image bytes in URLs.
- **Review Zip Production:** Use a dedicated deterministic SVG or canvas renderer for supported card blocks; React DOM components cannot be drawn directly onto a canvas. Render high-resolution `.png`/`.jpeg` outputs entirely in the browser, then use `fflate` to package review images into a ZIP. Keep this separate from the project-data and asset-archive formats.

---

## 5. UI & Usability Standards
- **Product direction:** Treat the app as a card-authoring workbench with a visual card catalog, not a marketing site. Use calm, precise configuration surfaces and image-led card browsing.
- **Navigation:** Keep desktop navigation persistent. At narrow widths, use compact navigation that preserves space for the active work area; avoid multi-row navigation consuming the initial viewport.
- **Card discovery:** Make the card library gallery-first, with search, filters, and a useful list alternative. Use verified full-card images when present; otherwise show the generated preview. Keep active filters visible and compact on mobile.
- **Editing:** Keep card editing divided into focused sections with validation that navigates to the relevant field. On wide screens, keep a live preview and validation summary alongside the form; on small screens, stack or collapse the preview. Keep save/cancel actions readily available.
- **Curation:** Use visual card selection in pack and deck workflows. Keep deck quantities explicit and soft-rule warnings informative but non-blocking.
- **Complex fields:** Present structured/repeating fields as readable typed controls (for example, resource plus amount for a cost). Show a human-readable summary in previews. Do not imply support for mechanics the configured schema cannot represent.
- **Progressive disclosure:** Group profile, schema, and template settings into scannable sections. Keep advanced configuration and project-file operations from overwhelming first-time setup; do not silently hide required settings.
- **Responsive and accessible behavior:** Avoid horizontal overflow at phone widths. Preserve semantic labels, keyboard operation, visible focus, adequate contrast, and clear loading, empty, saved, validation, and error states. Respect reduced-motion preferences.
- **Visual restraint:** Use grids where users browse or compare cards; prefer compact, clear forms for configuration. Treat benchmark sites as optional inspiration, not implementation specifications. Avoid decorative Bento layouts, glows, animation, or scrollytelling when they add friction to routine authoring.

## 6. Coding & Styling Standards
- **Strict TypeScript React:** **Zero `any`.** Enforce strict interface props, handle versioned migration types for JSON mutations, and use exhaustive switch-cases for rendering dynamic `FieldType` and template blocks. TypeScript types do not validate runtime-configured schemas or imported JSON: validate at runtime and keep untrusted input typed as `unknown` until checked. Treat current types as evolving implementation details; update them alongside the versioned manifest and migrations rather than preserving an early shape for compatibility.
- **Design-token preservation:** Persist finite design-token identifiers, not arbitrary CSS or class strings. Resolve identifiers through statically declared, whitelisted maps; never generate style values from user data. Follow the styling system already configured in the project; do not add Tailwind-specific requirements unless Tailwind is deliberately adopted and configured.