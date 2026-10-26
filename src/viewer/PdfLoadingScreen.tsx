// Dedicated full-view loading screen for InTabPDF document opening lifecycle.
import type { ReactNode } from 'react';
import './viewer.css';

interface PdfLoadingScreenProps {
  message?: string;
  className?: string;
}

export default function PdfLoadingScreen({
  message = 'Opening PDF…',
  className = '',
}: PdfLoadingScreenProps): ReactNode {
  return (
    <div
      className={`pdf-full-loading-screen ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="pdf-loading-view">
        <div className="pdf-loading-spinner" aria-hidden="true">
          <svg viewBox="0 0 48 48" className="pdf-spinner-svg">
            <circle
              className="pdf-spinner-track"
              cx="24"
              cy="24"
              r="18"
              fill="none"
              strokeWidth="4"
            />
            <circle
              className="pdf-spinner-arc"
              cx="24"
              cy="24"
              r="18"
              fill="none"
              strokeWidth="4"
            />
          </svg>
        </div>
        <span className="pdf-loading-text">{message}</span>
      </div>
    </div>
  );
}
