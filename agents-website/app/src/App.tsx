import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';

function getAuth() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const parts = atob(token).split(':');
    return { userId: parts[0], username: parts[1], role: parts[2] || 'user' };
  } catch { return null; }
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  return getAuth() ? children : <Navigate to="/login" />;
}

function RequireAdmin({ children }: { children: React.ReactElement }) {
  const auth = getAuth();
  if (!auth) return <Navigate to="/login" />;
  if (auth.role !== 'admin') return <Navigate to="/dashboard" />;
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/debug/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
      </Routes>
    </Router>
  );
}

export default App;
