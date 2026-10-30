# Universal Card Game Tool

Universal Card Game Tool is a local-first workbench for designing card games.
Define a game's card schema, create and visually browse cards, compose reusable
card templates, curate packs, and build decks—all in your browser.

> **Early-stage project:** Universal Card Game Tool is under active development.
> Back up important work with the ZIP export before clearing browser data or
> changing devices.

## Features

- **Game profiles:** Configure card types, subtypes, keywords, deck limits, and
  typed fields without hardcoding one game's mechanics into the app.
- **Structured fields:** Use text, number, boolean, enum, list, and repeating
  structured-entry fields. Structured entries can nest up to three levels for
  data such as resource-and-amount costs.
- **Card authoring:** Create cards with multiple faces, face-specific identity,
  rules and flavor text, tags, and profile-defined attributes.
- **Templates:** Arrange supported visual blocks and map them to card data
  using a finite set of design tokens.
- **Artwork:** Add art used inside a generated template or a full-card image
  that replaces the generated preview. Image assets are verified by content
  hash.
- **Discovery and curation:** Search and filter the card library, curate
  reusable packs, and build decks with explicit card quantities.
- **Project files:** Export metadata-only JSON or a ZIP backup containing the
  project manifest and artwork. Import files with validation and an explicit
  replace or merge choice.
- **Local persistence:** Project data and image bytes are stored in the
  browser's IndexedDB; no account or application server is required.

Deck-size and copy limits are advisory warnings in this version. Universal Card
Game Tool does not determine whether a deck is legal under any game's complete
rules. A browser currently contains one project with one game profile.

## Getting started

### Requirements

- Node.js 20.19+ or 22.12+
- pnpm
- A modern browser with IndexedDB and Web Crypto support

### Install and run

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite.

### Checks

```sh
pnpm test
pnpm run lint
pnpm run build
```

`pnpm run build` runs the TypeScript project build and creates the production
bundle in `dist/`. To serve that bundle locally:

```sh
pnpm run preview
```

## Data and backups

Universal Card Game Tool runs without a backend, but its project data is **not
automatically synced or backed up**. It is stored in the current browser on the
current device. Clearing that browser's site data can remove the project.

- **Export JSON** contains project metadata and asset references; it does not
  contain image bytes.
- **Export ZIP backup** is the portable backup and includes the manifest and
  artwork assets.

Store ZIP backups somewhere separate from the browser. Review imported files
and their replace/merge policy before applying them.

## Technology

- React
- TypeScript
- Vite
- IndexedDB and Web Crypto browser APIs
- `fflate` for ZIP archive packaging

## License and game content

The project source code is licensed under the [MIT License](./LICENSE).
Third-party packages retain their own licenses. Attribution for template files
present in Git history is in [THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES).
The Universal Card Game Tool favicon was created with AI assistance as an
original SVG graphic; it does not depict a real card or third-party game
artwork.
Card names, game rules, logos, and artwork from third-party games may be
protected by their respective owners; they are not included as licensed game
content by this project. Only add content you have permission to use and
distribute.
