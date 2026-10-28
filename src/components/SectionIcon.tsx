interface SectionIconProps {
  readonly paths: readonly string[];
  readonly className?: string;
}

/**
 * Renders a small, stroke-based structural icon from a finite path list.
 *
 * Icons are decorative and always hidden from assistive technology; the
 * adjacent text label remains the accessible name.
 */
export function SectionIcon({ paths, className }: SectionIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
