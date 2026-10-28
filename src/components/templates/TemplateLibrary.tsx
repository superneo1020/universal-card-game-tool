import { useId, useState } from 'react';

import { getSection } from '../../app/navigation';
import {
  createCardTemplateDraft,
  createTemplateBlock,
} from '../../project/projectModel';
import type {
  BlockType,
  CardTemplate,
  DesignTokenId,
  TemplateBlock,
} from '../../types/Card';
import type { GameProfile } from '../../types/Game';
import type { ProjectManifest } from '../../types/ProjectManifest';
import type { ValidationIssue } from '../../utils/validation';
import {
  DESIGN_TOKEN_IDS,
  getTemplateBlockMappingOptions,
} from '../../utils/validation';
import { EmptyState } from '../EmptyState';
import { SectionIcon } from '../SectionIcon';

const TEMPLATE_ICON_PATHS = getSection('templates').iconPaths;

const BLOCK_TYPES: readonly { readonly type: BlockType; readonly label: string }[] =
  [
    { type: 'header', label: 'Header' },
    { type: 'art_box', label: 'Artwork box' },
    { type: 'textbox', label: 'Text box' },
    { type: 'stat_badge', label: 'Stat badge' },
    { type: 'splitter', label: 'Splitter' },
    { type: 'tag_list', label: 'Tag list' },
    { type: 'structured_list', label: 'Structured list' },
  ];

const LAYOUTS: readonly {
  readonly value: CardTemplate['layout'];
  readonly label: string;
}[] = [
  { value: 'single', label: 'Single face' },
  { value: 'double_sided', label: 'Double-sided' },
  { value: 'split', label: 'Split' },
];

function isBlockType(value: string): value is BlockType {
  return BLOCK_TYPES.some((item) => item.type === value);
}

function isDesignTokenId(value: string): value is DesignTokenId {
  return DESIGN_TOKEN_IDS.some((token) => token === value);
}

function summarizeIssues(issues: readonly ValidationIssue[]): string {
  const preview = issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(' ');

  return issues.length > 3
    ? `${preview} (+${issues.length - 3} more)`
    : preview;
}

function reindexBlocks(blocks: readonly TemplateBlock[]): TemplateBlock[] {
  return blocks.map((block, index) => ({ ...block, order: index }));
}

interface TemplateLibraryProps {
  readonly project: ProjectManifest;
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly onSave: (template: CardTemplate) => Promise<boolean>;
  readonly onDelete: (templateId: string) => Promise<boolean>;
}

type EditorState =
  | { readonly mode: 'new' }
  | { readonly mode: 'edit'; readonly templateId: string };

interface TemplateEditorProps {
  readonly initialTemplate: CardTemplate | null;
  readonly profile: GameProfile;
  readonly saving: boolean;
  readonly saveErrorMessage: string | null;
  readonly saveIssues: readonly ValidationIssue[];
  readonly onSave: (template: CardTemplate) => Promise<boolean>;
  readonly onCancel: () => void;
}

function TemplateEditor({
  initialTemplate,
  profile,
  saving,
  saveErrorMessage,
  saveIssues,
  onSave,
  onCancel,
}: TemplateEditorProps) {
  const nameId = useId();
  const layoutId = useId();
  const addBlockId = useId();
  const [draft, setDraft] = useState<CardTemplate>(() =>
    initialTemplate === null
      ? createCardTemplateDraft(profile.id)
      : structuredClone(initialTemplate),
  );
  const [blockToAdd, setBlockToAdd] = useState<BlockType>('textbox');
  const nameValid = draft.name.trim().length > 0;

  function withDefaultMapping(
    block: TemplateBlock,
  ): TemplateBlock {
    if (block.mappingKey !== undefined) {
      return block;
    }

    const firstOption = getTemplateBlockMappingOptions(
      block.type,
      profile,
    )[0];

    return firstOption === undefined
      ? block
      : { ...block, mappingKey: firstOption.key };
  }

  function addBlock() {
    setDraft((current) => ({
      ...current,
      blocks: [
        ...current.blocks,
        withDefaultMapping(
          createTemplateBlock(blockToAdd, current.blocks.length),
        ),
      ],
    }));
  }

  function changeBlockType(blockId: string, type: BlockType) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        const replacement = withDefaultMapping(
          createTemplateBlock(type, block.order),
        );

        return {
          ...replacement,
          id: block.id,
          order: block.order,
        };
      }),
    }));
  }

  function updateBlock(
    blockId: string,
    patch: Partial<
      Pick<
        TemplateBlock,
        'mappingKey' | 'designTokenStyle' | 'hideWhenEmpty'
      >
    >,
  ) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, ...patch } : block,
      ),
    }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.blocks.length) {
        return current;
      }

      const blocks = [...current.blocks];
      const currentBlock = blocks[index];
      const targetBlock = blocks[targetIndex];
      if (currentBlock === undefined || targetBlock === undefined) {
        return current;
      }

      blocks[index] = targetBlock;
      blocks[targetIndex] = currentBlock;

      return { ...current, blocks: reindexBlocks(blocks) };
    });
  }

  function removeBlock(blockId: string) {
    setDraft((current) => ({
      ...current,
      blocks: reindexBlocks(
        current.blocks.filter((block) => block.id !== blockId),
      ),
    }));
  }

  function submit() {
    if (!nameValid) {
      return;
    }

    void onSave({
      ...draft,
      name: draft.name.trim(),
      blocks: reindexBlocks(draft.blocks),
    });
  }

  return (
    <div className="collection-editor">
      <div className="collection-editor__heading">
        <div>
          <p className="eyebrow">
            {initialTemplate === null ? 'New template' : 'Edit template'}
          </p>
          <h3>
            {initialTemplate === null
              ? 'Compose a card layout'
              : draft.name}
          </h3>
        </div>
        <span className="chip chip--muted">
          {draft.blocks.length} block{draft.blocks.length === 1 ? '' : 's'}
        </span>
      </div>

      {saveErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">{saveErrorMessage}</p>
          {saveIssues.length === 0 ? null : (
            <p>{summarizeIssues(saveIssues)}</p>
          )}
        </div>
      )}

      <div className="form-field">
        <label htmlFor={nameId}>Template name</label>
        <input
          id={nameId}
          className="text-input"
          value={draft.name}
          placeholder="e.g. Creature standard"
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />
      </div>

      <div className="form-field">
        <label htmlFor={layoutId}>Layout</label>
        <select
          id={layoutId}
          className="select-input"
          value={draft.layout}
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === 'single' ||
              value === 'double_sided' ||
              value === 'split'
            ) {
              setDraft((current) => ({ ...current, layout: value }));
            }
          }}
        >
          {LAYOUTS.map((layout) => (
            <option key={layout.value} value={layout.value}>
              {layout.label}
            </option>
          ))}
        </select>
      </div>

      {draft.layout === 'single' ? null : (
        <p className="collection-note">
          Multi-face layouts can be configured here, but the card editor
          currently edits only the first face.
        </p>
      )}

      <div className="collection-subsection">
        <div className="collection-subsection__heading">
          <h4>Blocks</h4>
          <span className="chip chip--muted">Rendered in order</span>
        </div>

        {draft.blocks.length === 0 ? (
          <p className="collection-note">
            This template has no blocks. Add one or more structural blocks.
          </p>
        ) : (
          <ol className="template-block-list">
            {draft.blocks.map((block, index) => {
              const mappingOptions = getTemplateBlockMappingOptions(
                block.type,
                profile,
              );

              return (
                <li className="template-block" key={block.id}>
                  <div className="template-block__heading">
                    <span className="template-block__order">
                      {index + 1}
                    </span>
                    <span className="template-block__label">
                      {BLOCK_TYPES.find((item) => item.type === block.type)
                        ?.label ?? block.type}
                    </span>
                    <div className="template-block__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        aria-label={`Move ${block.type} block up`}
                        onClick={() => moveBlock(index, -1)}
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        aria-label={`Move ${block.type} block down`}
                        onClick={() => moveBlock(index, 1)}
                        disabled={index === draft.blocks.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="button button--danger-ghost"
                        onClick={() => removeBlock(block.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="template-block__fields">
                    <div className="form-field">
                      <label htmlFor={`${block.id}-type`}>Block type</label>
                      <select
                        id={`${block.id}-type`}
                        className="select-input"
                        value={block.type}
                        onChange={(event) => {
                          if (isBlockType(event.target.value)) {
                            changeBlockType(block.id, event.target.value);
                          }
                        }}
                      >
                        {BLOCK_TYPES.map((item) => (
                          <option key={item.type} value={item.type}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <label htmlFor={`${block.id}-token`}>
                        Design token
                      </label>
                      <select
                        id={`${block.id}-token`}
                        className="select-input"
                        value={block.designTokenStyle}
                        onChange={(event) => {
                          if (isDesignTokenId(event.target.value)) {
                            updateBlock(block.id, {
                              designTokenStyle: event.target.value,
                            });
                          }
                        }}
                      >
                        {DESIGN_TOKEN_IDS.map((token) => (
                          <option key={token} value={token}>
                            {token}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <label htmlFor={`${block.id}-mapping`}>
                        Data mapping
                      </label>
                      <select
                        id={`${block.id}-mapping`}
                        className="select-input"
                        value={block.mappingKey ?? ''}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            mappingKey:
                              event.target.value === ''
                                ? undefined
                                : event.target.value,
                          })
                        }
                      >
                        <option value="">
                          {mappingOptions.length === 0
                            ? 'No mapping available'
                            : 'Unmapped'}
                        </option>
                        {mappingOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {block.type === 'art_box' ||
                    block.type === 'textbox' ||
                    block.type === 'stat_badge' ||
                    block.type === 'tag_list' ||
                    block.type === 'structured_list' ? (
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={block.hideWhenEmpty === true}
                          onChange={(event) =>
                            updateBlock(block.id, {
                              hideWhenEmpty: event.target.checked
                                ? true
                                : undefined,
                            })
                          }
                        />
                        <span>Hide when empty</span>
                      </label>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="inline-form">
          <label className="sr-only" htmlFor={addBlockId}>
            Block type to add
          </label>
          <select
            id={addBlockId}
            className="select-input"
            value={blockToAdd}
            onChange={(event) => {
              if (isBlockType(event.target.value)) {
                setBlockToAdd(event.target.value);
              }
            }}
          >
            {BLOCK_TYPES.map((item) => (
              <option key={item.type} value={item.type}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--secondary"
            onClick={addBlock}
          >
            Add block
          </button>
        </div>
      </div>

      <div className="collection-editor__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={!nameValid || saving}
        >
          {saving ? 'Saving…' : 'Save template'}
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Template workspace for composing structural card blocks. */
export function TemplateLibrary({
  project,
  saving,
  saveErrorMessage,
  saveIssues,
  onSave,
  onDelete,
}: TemplateLibraryProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const templates = project.templates;
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    templates[0] ??
    null;
  const editorTemplate =
    editor?.mode === 'edit'
      ? (templates.find((template) => template.id === editor.templateId) ??
        null)
      : null;
  const isEditorOpen =
    editor !== null && (editor.mode === 'new' || editorTemplate !== null);
  const usageCount = (templateId: string) =>
    project.cards.filter((card) => card.templateId === templateId).length;
  const selectedUsage =
    selectedTemplate === null ? 0 : usageCount(selectedTemplate.id);
  const canDeleteSelected =
    selectedTemplate !== null &&
    templates.length > 1 &&
    selectedUsage === 0;

  async function handleSave(template: CardTemplate) {
    const saved = await onSave(template);

    if (saved) {
      setSelectedTemplateId(template.id);
      setEditor(null);
      setPendingDeleteId(null);
    }

    return saved;
  }

  async function handleDelete(templateId: string) {
    const deleted = await onDelete(templateId);

    if (deleted) {
      setPendingDeleteId(null);
      setSelectedTemplateId(null);
      setEditor(null);
    }
  }

  if (isEditorOpen) {
    return (
      <TemplateEditor
        key={editor?.mode === 'new' ? 'new' : (editorTemplate?.id ?? 'none')}
        initialTemplate={editor?.mode === 'edit' ? editorTemplate : null}
        profile={project.profile}
        saving={saving}
        saveErrorMessage={saveErrorMessage}
        saveIssues={saveIssues}
        onSave={handleSave}
        onCancel={() => setEditor(null)}
      />
    );
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<SectionIcon paths={TEMPLATE_ICON_PATHS} />}
        title="No card templates yet"
        description="Templates arrange header, artwork, text, stats, splitters, and tag blocks."
        actionLabel="Create template"
        onAction={() => setEditor({ mode: 'new' })}
      />
    );
  }

  return (
    <div className="card-library">
      {saveErrorMessage === null ? null : (
        <div className="validation-banner validation-banner--error" role="alert">
          <p className="validation-banner__title">{saveErrorMessage}</p>
          {saveIssues.length === 0 ? null : (
            <p>{summarizeIssues(saveIssues)}</p>
          )}
        </div>
      )}

      <div className="card-library__toolbar">
        <div className="card-library__toolbar-meta">
          <span className="card-library__count">
            {templates.length} template{templates.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setEditor({ mode: 'new' })}
            disabled={saving}
          >
            New template
          </button>
        </div>
      </div>

      <div className="card-library__layout">
        <div className="card-library__list-panel">
          <ul className="card-list">
            {templates.map((template) => {
              const active = selectedTemplate?.id === template.id;
              const used = usageCount(template.id);

              return (
                <li key={template.id}>
                  <button
                    type="button"
                    className={`card-list-item${active ? ' card-list-item--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setPendingDeleteId(null);
                    }}
                  >
                    <span className="card-list-item__name">
                      {template.name.trim().length === 0
                        ? 'Untitled template'
                        : template.name}
                    </span>
                    <span className="card-list-item__meta">
                      {template.layout} · {template.blocks.length} block
                      {template.blocks.length === 1 ? '' : 's'} · {used} card
                      {used === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card-library__detail">
          {selectedTemplate === null ? (
            <div className="card-library__empty-filter">
              <p>Select a template to inspect it.</p>
            </div>
          ) : (
            <article className="collection-summary">
              <p className="eyebrow">Template</p>
              <h3>
                {selectedTemplate.name.trim().length === 0
                  ? 'Untitled template'
                  : selectedTemplate.name}
              </h3>
              <dl className="collection-meta">
                <div>
                  <dt>Layout</dt>
                  <dd>{selectedTemplate.layout}</dd>
                </div>
                <div>
                  <dt>Blocks</dt>
                  <dd>{selectedTemplate.blocks.length}</dd>
                </div>
                <div>
                  <dt>Cards</dt>
                  <dd>{selectedUsage}</dd>
                </div>
              </dl>

              <ol className="collection-card-list">
                {selectedTemplate.blocks.map((block) => (
                  <li key={block.id}>
                    {block.type}
                    {block.mappingKey === undefined
                      ? ''
                      : ` → ${block.mappingKey}`}{' '}
                    <span className="chip chip--muted">
                      {block.designTokenStyle}
                    </span>
                  </li>
                ))}
              </ol>

              {templates.length <= 1 ? (
                <p className="collection-note">
                  A project must keep at least one template.
                </p>
              ) : selectedUsage > 0 ? (
                <p className="collection-note">
                  This template is used by {selectedUsage} card
                  {selectedUsage === 1 ? '' : 's'}. Reassign them before
                  deleting it.
                </p>
              ) : null}

              {pendingDeleteId === selectedTemplate.id ? (
                <div className="card-delete-confirm" role="alert">
                  <p>
                    Delete “{selectedTemplate.name || 'Untitled template'}”?
                  </p>
                  <div className="card-delete-confirm__actions">
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={saving || !canDeleteSelected}
                      onClick={() => {
                        void handleDelete(selectedTemplate.id);
                      }}
                    >
                      Delete template
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setPendingDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card-preview__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() =>
                      setEditor({
                        mode: 'edit',
                        templateId: selectedTemplate.id,
                      })
                    }
                    disabled={saving}
                  >
                    Edit template
                  </button>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    onClick={() => setPendingDeleteId(selectedTemplate.id)}
                    disabled={saving || !canDeleteSelected}
                  >
                    Delete
                  </button>
                </div>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
