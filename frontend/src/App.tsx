import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Inbox from "./pages/Inbox";
import Matrix from "./pages/Matrix";
import Tasks from "./pages/Tasks";
import ItemDetail from "./pages/ItemDetail";
import Review from "./pages/Review";
import Settings from "./pages/Settings";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/matrix" element={<Matrix />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/review" element={<Review />} />
          <Route path="/items/:id" element={<ItemDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
