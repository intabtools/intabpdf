import { createContext } from 'react';

export interface ToastContextType {
  showToast: (message: string, duration?: number) => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);
