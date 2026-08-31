import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./AuthContext";
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

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe("useAuth", () => {
  it("throws when used outside AuthProvider", () => {
    // Suppress the expected React error boundary console noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used within AuthProvider");
    spy.mockRestore();
  });

  it("sets user to null (not undefined) when /auth/me returns 401", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(401, "Unauthorized"));

    function Consumer() {
      const { user, isLoading } = useAuth();
      if (isLoading) return <div>loading</div>;
      return <div>user:{user === null ? "null" : JSON.stringify(user)}</div>;
    }

    render(<Consumer />, { wrapper });

    await waitFor(() => expect(screen.getByText(/^user:/)).toHaveTextContent("user:null"));
  });
});
