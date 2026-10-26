interface LogoProps {
  size?: number;
  className?: string;
}

export default function Logo({ size = 26, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <rect width="1024" height="1024" rx="230" fill="#0B2EA8" />
      <path
        d="M300 184H600L784 368V730a110 110 0 0 1-110 110H350a110 110 0 0 1-110-110V244a60 60 0 0 1 60-60z"
        fill="#ffffff"
      />
      <path d="M600 184l184 184H664a64 64 0 0 1-64-64z" fill="#AAB8FF" />
      <rect x="336" y="464" width="96" height="96" rx="32" fill="#AAB8FF" />
      <rect x="336" y="600" width="96" height="152" rx="32" fill="#0B2EA8" />
      <rect x="492" y="600" width="196" height="40" rx="20" fill="#C2CBEA" />
      <rect x="492" y="680" width="148" height="40" rx="20" fill="#C2CBEA" />
    </svg>
  );
}
