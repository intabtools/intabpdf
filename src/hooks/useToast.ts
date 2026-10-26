import { useContext } from 'react';
import { ToastContext } from '../components/toastContextDef';
import type { ToastContextType } from '../components/toastContextDef';

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
