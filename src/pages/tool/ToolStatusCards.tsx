// Status cards displaying processing indicators and error states with retry actions for ToolPage.
import type { ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

export interface ToolStatusCardsProps {
  status: 'idle' | 'busy' | 'done';
  errorMessage: string | null;
  onClearError: () => void;
}

export default function ToolStatusCards({
  status,
  errorMessage,
  onClearError,
}: ToolStatusCardsProps): ReactNode {
  return (
    <>
      {status === 'busy' && (
        <div className="card busy" role="status" aria-live="polite">
          <div className="spin" />
          <b style={{ marginTop: '14px', fontSize: '16px' }}>Processing document...</b>
          <p className="lede" style={{ margin: '4px 0 0' }}>
            All operations run privately on your local device.
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          className="card busy"
          style={{
            borderColor: '#E81123',
            background: 'rgba(232, 17, 35, 0.08)',
            marginBottom: '16px',
          }}
          role="alert"
        >
          <AlertCircle size={28} color="#E81123" />
          <b style={{ marginTop: '8px', color: '#E81123' }}>Operation failed</b>
          <p className="lede" style={{ margin: '4px 0 14px' }}>
            {errorMessage}
          </p>
          <button
            type="button"
            className="cta"
            onClick={onClearError}
            style={{ background: 'var(--text)' }}
          >
            <RotateCcw size={16} />
            <span>Try again</span>
          </button>
        </div>
      )}
    </>
  );
}
