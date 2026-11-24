import type { CSSProperties, ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type NoticeBannerVariant = 'info' | 'success' | 'warning' | 'danger';

export interface NoticeBannerProps {
  /** Visual style variant. Defaults to 'info'. Does NOT automatically apply live-region roles. */
  variant?: NoticeBannerVariant;
  /** Explicit accessibility role: 'alert' (urgent), 'status' (polite update), 'region', or omit for static notices. */
  role?: 'alert' | 'status' | 'region' | null;
  /** Custom icon ReactNode, or boolean to toggle default variant icon. Defaults to true. */
  icon?: ReactNode | boolean;
  /** Bold heading or title displayed above or preceding the body. */
  title?: ReactNode;
  /** Main message content or nested elements. */
  children: ReactNode;
  /** Optional dismissal callback. When provided, renders an accessible dismiss button. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. Defaults to 'Dismiss notice'. */
  dismissLabel?: string;
  /** Additional CSS class names. */
  className?: string;
  /** Additional inline CSS styles for custom spacing or layout overrides. */
  style?: CSSProperties;
}

const DEFAULT_ICONS: Record<NoticeBannerVariant, (color: string) => ReactNode> = {
  info: (color) => <Info size={16} style={{ color, flexShrink: 0 }} />,
  success: (color) => <CheckCircle2 size={16} style={{ color, flexShrink: 0 }} />,
  warning: (color) => <AlertTriangle size={16} style={{ color, flexShrink: 0 }} />,
  danger: (color) => <AlertCircle size={16} style={{ color, flexShrink: 0 }} />,
};

const VARIANT_ICON_COLORS: Record<NoticeBannerVariant, string> = {
  info: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export default function NoticeBanner({
  variant = 'info',
  role,
  icon = true,
  title,
  children,
  onDismiss,
  dismissLabel = 'Dismiss notice',
  className = '',
  style,
}: NoticeBannerProps): ReactNode {
  // Live region role is never derived automatically from visual variant; explicit prop is required
  const effectiveRole = role === null || role === undefined ? undefined : role;

  // Resolve icon
  let resolvedIcon: ReactNode = null;
  if (icon === true) {
    resolvedIcon = DEFAULT_ICONS[variant](VARIANT_ICON_COLORS[variant]);
  } else if (icon && typeof icon !== 'boolean') {
    resolvedIcon = icon;
  }

  return (
    <div
      role={effectiveRole}
      className={`notice-banner notice-banner-${variant} ${className}`}
      style={style}
    >
      {resolvedIcon && (
        <span className="notice-banner-icon" aria-hidden="true">
          {resolvedIcon}
        </span>
      )}

      <div className="notice-banner-content">
        {title && <div className="notice-banner-title">{title}</div>}
        <div className="notice-banner-body">{children}</div>
      </div>

      {onDismiss && (
        <button
          type="button"
          className="notice-banner-dismiss"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
