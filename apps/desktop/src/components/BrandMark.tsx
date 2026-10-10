interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** The single Taxflow brand mark used in the titlebar, auth screen, and app icon. */
export function BrandMark({ size = 14, className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 19V9M10 19V5M16 19v-7M22 19H2"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
