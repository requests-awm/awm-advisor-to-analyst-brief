import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { bootstrapAuth, clearSession, redirectToOpsLogin } from './lib/authClient';
import type { CurrentUser } from './lib/types';
import { Header } from './components/Header';
import { FullScreenError, FullScreenLoader } from './components/BrandedStates';
import { Dashboard } from './components/Dashboard';
import { BriefForm } from './components/BriefForm';
import { BriefDetail } from './components/BriefDetail';
import { InterviewChat } from './components/InterviewChat';

type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; user: CurrentUser }
  | { status: 'redirecting' }
  | { status: 'error'; message: string };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    bootstrapAuth().then(setAuth as any);
  }, []);

  if (auth.status === 'loading') return <FullScreenLoader message="Signing you in…" />;
  if (auth.status === 'redirecting') return <FullScreenLoader message="Redirecting to sign in…" />;
  if (auth.status === 'error') return <FullScreenError message={auth.message} />;

  const user = auth.user;
  const onSignOut = () => {
    clearSession();
    redirectToOpsLogin('signed_out');
  };

  return (
    <BrowserRouter>
      <Header user={user} onSignOut={onSignOut} />
      <main>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/new" element={<BriefForm user={user} />} />
          <Route path="/interview" element={<InterviewChat user={user} />} />
          <Route path="/brief/:id/edit" element={<BriefForm user={user} />} />
          <Route path="/brief/:id" element={<BriefDetail user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
