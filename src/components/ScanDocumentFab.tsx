import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine } from 'lucide-react';
import { getPlatformType, type PlatformType } from '../platform';
import { isAndroidScannerSupported } from '../hooks/useScanDocument';
import {
  useFloatingScrollVisibility,
  usePrefersReducedMotion,
} from '../hooks/useFloatingScrollVisibility';

export interface ScanDocumentFabProps {
  isScanning: boolean;
  onScan: () => void;
  platform?: PlatformType;
  visible?: boolean;
  reducedMotion?: boolean;
}

const subscribeNoop = () => () => {};

/**
 * Google Pay-style floating pill button rendered centered above the Android HomePage
 * bottom navigation bar. Translates cleanly downward behind the bottom edge when
 * scrolling down and reveals when scrolling up.
 */
export function ScanDocumentFab({
  isScanning,
  onScan,
  platform,
  visible,
  reducedMotion,
}: ScanDocumentFabProps) {
  const resolvedPlatform = platform ?? getPlatformType();
  const isAndroid = isAndroidScannerSupported(resolvedPlatform);

  const scrollVisible = useFloatingScrollVisibility({
    disabled: !isAndroid || typeof visible === 'boolean',
  });
  const systemReducedMotion = usePrefersReducedMotion();

  const portalTarget = useSyncExternalStore(
    subscribeNoop,
    () => (isAndroid && typeof document !== 'undefined' ? document.querySelector('.app') : null),
    () => null,
  );

  if (!isAndroid) {
    return null;
  }

  const isVisible = visible ?? scrollVisible;
  const isReducedMotion = reducedMotion ?? systemReducedMotion;
  const shouldAnimateIcon = isVisible && !isScanning && !isReducedMotion;

  const label = isScanning ? 'Opening scanner…' : 'Scan Document';
  const ariaLabel = isScanning
    ? 'Opening document scanner'
    : 'Scan Document: Capture pages or import photos into a PDF';

  const content = (
    <div
      className="scan-fab-dock"
      data-testid="scan-document-fab-dock"
      data-visible={String(isVisible)}
    >
      <button
        type="button"
        className={`scan-fab ${isVisible ? 'is-visible' : 'is-hidden'}${
          shouldAnimateIcon ? ' has-idle-motion' : ''
        }`}
        disabled={isScanning}
        tabIndex={isVisible ? undefined : -1}
        aria-hidden={!isVisible}
        aria-label={ariaLabel}
        data-testid="scan-document-fab"
        data-visible={String(isVisible)}
        data-idle-animation={String(shouldAnimateIcon)}
        data-reduced-motion={String(isReducedMotion)}
        onClick={onScan}
      >
        <span className="scan-fab-icon" aria-hidden="true">
          <ScanLine size={20} strokeWidth={2.1} className="scan-fab-glyph" />
          <span className="scan-fab-beam" />
        </span>
        <span className="scan-fab-label">{label}</span>
      </button>
    </div>
  );

  return portalTarget ? createPortal(content, portalTarget) : content;
}
