import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Setup from "./pages/Setup";
import Inbox from "./pages/Inbox";
import Matrix from "./pages/Matrix";
import Tasks from "./pages/Tasks";
import ItemDetail from "./pages/ItemDetail";
import Review from "./pages/Review";
import Settings from "./pages/Settings";
import VerifyEmail from "./pages/VerifyEmail";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { useSetupStatus } from "./context/AuthContext";

function SetupGate({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading } = useSetupStatus();

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Lädt…</div>;
  }

  if (status && status.initialized === false) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <SetupGate>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

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
    </SetupGate>
  );
}
