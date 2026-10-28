import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { GameProfile } from '../types/Game';
import type { CardRecord } from '../types/CardRecord';
import { computeSha256Hex } from '../utils/validation';
import {
  analyzeProjectFile,
  createProjectArchive,
  createProjectJson,
} from './projectFiles';
import { createProjectManifest } from './projectModel';

function makeProfile(): GameProfile {
  return {
    id: 'profile-1',
    name: 'Test Game',
    cardTypes: ['Creature'],
    subtypes: ['Dragon'],
    keywords: ['Flying'],
    fieldDefinitions: [
      {
        key: 'attack',
        label: 'Attack',
        type: { type: 'number' },
        target: 'root',
        required: true,
        defaultValue: 0,
      },
    ],
    deckRules: { minSize: 40, maxSize: 60, maxCopiesPerCard: 4 },
  };
}

describe('project files', () => {
  it('parses a metadata-only JSON export', async () => {
    const project = createProjectManifest(makeProfile(), 'Review Project');
    const file = new File([createProjectJson(project)], 'project.json', {
      type: 'application/json',
    });

    const analysis = await analyzeProjectFile(file);

    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.preview.kind).toBe('json');
      expect(analysis.preview.manifest.projectName).toBe('Review Project');
      expect(analysis.preview.assetBytes.size).toBe(0);
      expect(analysis.preview.collisions).toEqual([]);
    }
  });

  it('reports ID collisions against an existing project', async () => {
    const project = createProjectManifest(makeProfile());
    const file = new File([createProjectJson(project)], 'project.json', {
      type: 'application/json',
    });

    const analysis = await analyzeProjectFile(file, project);

    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.preview.collisions.length).toBeGreaterThan(0);
      expect(analysis.preview.collisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'profile' }),
          expect.objectContaining({ kind: 'template' }),
        ]),
      );
    }
  });

  it('verifies every asset in a ZIP backup', async () => {
    const project = createProjectManifest(makeProfile());
    const bytes = new TextEncoder().encode('hello');
    const assetId = await computeSha256Hex(bytes);
    const withAsset = {
      ...project,
      assets: [
        {
          assetId,
          fileName: 'hello.png',
          mimeType: 'image/png',
          byteSize: bytes.byteLength,
        },
      ],
    };
    const zipped = zipSync({
      'project.json': new TextEncoder().encode(createProjectJson(withAsset)),
      [`assets/${assetId}`]: bytes,
    });
    const file = new File([new Uint8Array(zipped)], 'project.zip', {
      type: 'application/zip',
    });

    const analysis = await analyzeProjectFile(file);

    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.preview.kind).toBe('zip');
      expect(analysis.preview.assetIssues).toEqual([]);
      expect(analysis.preview.assetBytes.get(assetId)).toEqual(bytes);
    }
  });

  it('rejects a ZIP whose asset bytes do not match the manifest', async () => {
    const project = createProjectManifest(makeProfile());
    const expected = new TextEncoder().encode('hello');
    const assetId = await computeSha256Hex(expected);
    const withAsset = {
      ...project,
      assets: [
        {
          assetId,
          fileName: 'hello.png',
          mimeType: 'image/png',
          byteSize: expected.byteLength,
        },
      ],
    };
    const zipped = zipSync({
      'project.json': new TextEncoder().encode(createProjectJson(withAsset)),
      [`assets/${assetId}`]: new TextEncoder().encode('tampered'),
    });
    const file = new File([new Uint8Array(zipped)], 'project.zip', {
      type: 'application/zip',
    });

    const analysis = await analyzeProjectFile(file);

    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(analysis.preview.assetIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'content_hash_mismatch' }),
          expect.objectContaining({ code: 'byte_size_mismatch' }),
        ]),
      );
      expect(analysis.preview.assetBytes.size).toBe(0);
    }
  });

  it('round-trips structured entries without losing order', async () => {
    const profile = makeProfile();
    profile.fieldDefinitions.push({
      key: 'cost',
      label: 'Cost',
      target: 'face',
      type: {
        type: 'structured',
        children: [
          {
            key: 'resource',
            label: 'Resource',
            type: { type: 'enum', options: ['Generic', 'Red'] },
            required: true,
          },
          {
            key: 'amount',
            label: 'Amount',
            type: { type: 'number' },
            required: true,
          },
        ],
      },
    });
    const project = createProjectManifest(profile);
    const card: CardRecord = {
      id: 'card-structured',
      profileId: profile.id,
      templateId: project.templates[0]?.id ?? '',
      name: 'Cost Test',
      cardType: 'Creature',
      subtypes: ['Dragon'],
      faces: [
        {
          faceId: 'front',
          rulesText: '',
          artAssetId: null,
          faceAttributes: {
            cost: [
              { entryId: 'entry-2', values: { resource: 'Red', amount: 2 } },
              {
                entryId: 'entry-1',
                values: { resource: 'Generic', amount: 1 },
              },
            ],
          },
        },
      ],
      rootAttributes: { attack: 3 },
      tags: [],
    };
    const withCard = { ...project, cards: [card] };
    const file = new File([createProjectJson(withCard)], 'project.json', {
      type: 'application/json',
    });

    const analysis = await analyzeProjectFile(file);

    expect(analysis.ok).toBe(true);
    if (analysis.ok) {
      expect(
        analysis.preview.manifest.cards[0]?.faces[0]?.faceAttributes.cost,
      ).toEqual(card.faces[0]?.faceAttributes.cost);
    }
  });

  it('builds a manifest-only ZIP when the project has no assets', async () => {
    const project = createProjectManifest(makeProfile());

    const result = await createProjectArchive(project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName.endsWith('.zip')).toBe(true);
      expect(result.blob.size).toBeGreaterThan(0);
    }
  });
});
