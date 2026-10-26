// Full-screen file-processing loader for heavy operations (merging, compressing, image conversion, etc.).
import type { ReactNode } from 'react';
import './processing.css';

interface ProcessingLoadingScreenProps {
  message?: string;
  className?: string;
}

export default function ProcessingLoadingScreen({
  message = 'Processing PDF…',
  className = '',
}: ProcessingLoadingScreenProps): ReactNode {
  return (
    <div
      className={`processing-full-loading-screen ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="processing-loading-view">
        <div className="processing-loading-spinner" aria-hidden="true">
          <svg viewBox="0 0 52 52" className="processing-spinner-svg">
            {/* Outer Track */}
            <circle
              className="processing-spinner-track"
              cx="26"
              cy="26"
              r="20"
              fill="none"
              strokeWidth="3.5"
            />
            {/* Outer Orbit Arc */}
            <circle
              className="processing-spinner-arc"
              cx="26"
              cy="26"
              r="20"
              fill="none"
              strokeWidth="3.5"
            />
            {/* Inner Counter-Orbit Arc */}
            <circle
              className="processing-spinner-inner"
              cx="26"
              cy="26"
              r="12"
              fill="none"
              strokeWidth="2.5"
            />
          </svg>
        </div>
        <span className="processing-loading-text">{message}</span>
      </div>
    </div>
  );
}
