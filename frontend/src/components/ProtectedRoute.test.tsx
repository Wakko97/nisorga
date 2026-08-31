import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProtectedRoute from "./ProtectedRoute";
import { AuthProvider } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

function renderWithRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/inbox"]}>
          <Routes>
            <Route path="/login" element={<div>Login-Seite</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/inbox" element={<Outlet context="protected content" />}>
                <Route index element={<div>Geschütztes Inhalt</div>} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("ProtectedRoute", () => {
  it("redirects to /login when there is no user (401)", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    renderWithRouter();
    await waitFor(() => expect(screen.getByText("Login-Seite")).toBeInTheDocument());
  });

  it("renders the outlet content when a user is present", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ id: "1", email: "a@b.com", name: "A", role: "OWNER" });
    renderWithRouter();
    await waitFor(() => expect(screen.getByText("Geschütztes Inhalt")).toBeInTheDocument());
  });
});
