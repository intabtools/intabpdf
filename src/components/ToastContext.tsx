import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import Toast from './Toast';
import { ToastContext } from './toastContextDef';

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [timerId, setTimerId] = useState<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, duration = 2500) => {
    if (timerId) {
      clearTimeout(timerId);
    }
    setToastMessage(message);
    const id = setTimeout(() => {
      setToastMessage(null);
      setTimerId(null);
    }, duration);
    setTimerId(id);
  }, [timerId]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toastMessage && <Toast message={toastMessage} />}
    </ToastContext.Provider>
  );
}
