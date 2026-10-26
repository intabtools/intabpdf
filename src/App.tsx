import { Component, Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ShellContainer from './components/ShellContainer';
import { ToastProvider } from './components/ToastContext';
import { ProcessingProvider } from './components/ProcessingContext';
import { FileConflictProvider } from './components/FileConflictDialog';
import { ViewerProvider } from './viewer/ViewerContext';
import { getInitialDestination, isScreenEnabled, resolveDestination } from './config/screens';
import { getPlatformType } from './platform';

// On-demand lazy-loaded screen components for optimal startup bundle size
const HomePage = lazy(() => import('./pages/HomePage'));
const ViewerPage = lazy(() => import('./viewer/ViewerPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const ToolPage = lazy(() => import('./pages/ToolPage'));

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ScreenErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="cnt" style={{ padding: '32px 16px' }}>
          <div className="card busy" style={{ padding: '36px 20px', textAlign: 'center' }}>
            <b style={{ fontSize: '18px' }}>Failed to load screen</b>
            <p className="lede" style={{ margin: '8px 0 20px' }}>
              {this.state.error?.message || 'An unexpected loading error occurred.'}
            </p>
            <button
              type="button"
              className="cta"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageSuspenseFallback() {
  return (
    <div
      className="cnt"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '260px',
        padding: '32px',
      }}
    >
      <div className="spin" />
    </div>
  );
}

function ToolRouteGuard() {
  const location = useLocation();
  const platform = getPlatformType();
  const resolved = resolveDestination(location.pathname, platform);

  if (resolved !== location.pathname) {
    return <Navigate to={resolved} replace />;
  }

  return <ToolPage key={location.pathname} />;
}

export default function App(): ReactNode {
  const platform = getPlatformType();
  const initialDest = getInitialDestination(platform);

  return (
    <ToastProvider>
      <ProcessingProvider>
        <FileConflictProvider>
          <ViewerProvider>
          <ShellContainer>
            <ScreenErrorBoundary>
              <Suspense fallback={<PageSuspenseFallback />}>
                <Routes>
                  <Route
                    path="/"
                    element={
                      !isScreenEnabled('home', platform) ? (
                        <Navigate to={initialDest} replace />
                      ) : initialDest !== '/' ? (
                        <Navigate to={initialDest} replace />
                      ) : (
                        <HomePage />
                      )
                    }
                  />
                  <Route
                    path="/viewer"
                    element={
                      isScreenEnabled('viewer', platform) ? (
                        <ViewerPage />
                      ) : (
                        <Navigate to={initialDest} replace />
                      )
                    }
                  />
                  <Route
                    path="/about"
                    element={
                      isScreenEnabled('about', platform) ? (
                        <AboutPage />
                      ) : (
                        <Navigate to={initialDest} replace />
                      )
                    }
                  />
                  <Route
                    path="/tool/:toolId"
                    element={
                      isScreenEnabled('tool', platform) ? (
                        <ToolRouteGuard />
                      ) : (
                        <Navigate to={initialDest} replace />
                      )
                    }
                  />
                  <Route path="*" element={<Navigate to={initialDest} replace />} />
                </Routes>
              </Suspense>
            </ScreenErrorBoundary>
          </ShellContainer>
        </ViewerProvider>
      </FileConflictProvider>
    </ProcessingProvider>
  </ToastProvider>
);
}
