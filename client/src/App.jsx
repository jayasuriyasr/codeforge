import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Catalog from './pages/Catalog.jsx';
import Solve from './pages/Solve.jsx';
import Me from './pages/Me.jsx';

// No auth, no server. Every route is a static page; judging runs in the browser.
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/p/:slug" element={<Solve />} />
        <Route path="/me" element={<Me />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
