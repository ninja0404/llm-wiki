import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { Layout } from '@/components/Layout';
import { DashboardView } from '@/views/DashboardView';
import { SourcesView } from '@/views/SourcesView';
import { WikiView } from '@/views/WikiView';
import { SearchView } from '@/views/SearchView';
import { ChatView } from '@/views/ChatView';
import { GraphView } from '@/views/GraphView';
import { ActivityView } from '@/views/ActivityView';
import { SettingsView } from '@/views/SettingsView';
import { LoginView } from '@/views/LoginView';
import { useAuthStore } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function SessionLoader({ children }: { children: React.ReactNode }) {
  const { setUser } = useAuthStore();
  const { setWorkspaces, setCurrentWorkspace } = useWorkspaceStore();

  useEffect(() => {
    fetch('/api/auth/get-session', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        if (data?.user) {
          setUser({ id: data.user.id, email: data.user.email, name: data.user.name });

          const meRes = await fetch('/api/me', { credentials: 'include' });
          if (meRes.ok) {
            const meData = await meRes.json();
            setWorkspaces(meData.data.workspaces);
            if (meData.data.workspaces.length > 0) {
              setCurrentWorkspace(meData.data.workspaces[0]);
            }
          }
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        setUser(null);
      });
  }, [setUser, setWorkspaces, setCurrentWorkspace]);

  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionLoader>
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route
            element={
              <AuthGuard>
                <Layout />
              </AuthGuard>
            }
          >
            <Route index element={<DashboardView />} />
            <Route path="sources" element={<SourcesView />} />
            <Route path="wiki" element={<WikiView />} />
            <Route path="wiki/:slug" element={<WikiView />} />
            <Route path="search" element={<SearchView />} />
            <Route path="chat" element={<ChatView />} />
            <Route path="graph" element={<GraphView />} />
            <Route path="activity" element={<ActivityView />} />
            <Route path="settings" element={<SettingsView />} />
          </Route>
        </Routes>
      </SessionLoader>
    </BrowserRouter>
  );
}
