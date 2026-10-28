import { useId } from 'react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly actionNote?: string;
  readonly checklist?: readonly string[];
}

/**
 * Shared empty state for a workspace section.
 *
 * Actions are rendered disabled until the corresponding editing slice exists;
 * the accompanying note keeps the UI honest instead of presenting a dead
 * button as if it were wired up.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionNote,
  checklist,
}: EmptyStateProps) {
  const noteId = useId();

  return (
    <div className="empty-state">
      <div className="empty-state__glyph">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>

      {checklist !== undefined ? (
        <ul className="empty-state__checklist">
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      {actionLabel !== undefined ? (
        <div className="empty-state__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={onAction}
            disabled={onAction === undefined}
            aria-describedby={actionNote === undefined ? undefined : noteId}
          >
            {actionLabel}
          </button>
          {actionNote === undefined ? null : (
            <p id={noteId} className="empty-state__note">
              {actionNote}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
