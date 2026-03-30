interface ThriveLogoProps {
  size?: number;
  class?: string;
}

export function ThriveLogo({ size = 24, class: className }: ThriveLogoProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      aria-hidden="true"
      class={className}
    >
      <polygon
        fill="var(--color-accent)"
        points="128,24 210,72 210,170 128,218 46,170 46,72"
      />
      <g transform="translate(128 121) scale(1.8)">
        <g fill="#FFFFFF">
          <rect x="-36" y="-16" width="9" height="32" rx="4" />
          <rect x="-25" y="-22" width="11" height="44" rx="5" />
          <rect x="14" y="-22" width="11" height="44" rx="5" />
          <rect x="27" y="-16" width="9" height="32" rx="4" />
        </g>
        <rect x="-14" y="-3" width="28" height="6" fill="#FFFFFF" />
      </g>
    </svg>
  );
}
