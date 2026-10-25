import type { ReactNode } from 'react';
import './toast.css';

interface ToastProps {
  message: string;
}

export default function Toast({ message }: ToastProps): ReactNode {
  return (
    <div className="intab-toast" role="status" aria-live="polite">
      <span className="intab-toast-dot" aria-hidden="true" />
      <span className="intab-toast-msg">{message}</span>
    </div>
  );
}
