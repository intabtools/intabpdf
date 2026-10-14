import { BrowserRouter, HashRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

interface AppRouterProps {
    children: ReactNode;
}
export default function AppRouter({ children }: AppRouterProps) {
    const Router =
        import.meta.env.MODE === 'desktop'
            ? HashRouter
            : BrowserRouter;

    return <Router>{children}</Router>;
}