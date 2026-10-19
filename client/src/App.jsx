import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Catalog from './pages/Catalog.jsx';
import Solve from './pages/Solve.jsx';
import Me from './pages/Me.jsx';
import Login from './pages/Login.jsx';
import AdminProblems from './pages/AdminProblems.jsx';
import ProblemEditor from './pages/ProblemEditor.jsx';
import RequireAdmin from './components/RequireAdmin.jsx';

// No backend of our own: pages read and write Supabase directly (guarded by
// row-level security), and judging runs in the browser.
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/p/:slug" element={<Solve />} />
        <Route path="/me" element={<Me />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<RequireAdmin><AdminProblems /></RequireAdmin>} />
        <Route path="/admin/new" element={<RequireAdmin><ProblemEditor /></RequireAdmin>} />
        <Route path="/admin/edit/:id" element={<RequireAdmin><ProblemEditor /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
