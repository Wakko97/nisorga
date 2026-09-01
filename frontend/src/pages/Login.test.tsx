import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Login from "./Login";
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Login", () => {
  it("submits email and password to /auth/login", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "1", email: "a@b.com", name: "A", role: "OWNER" });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("E-Mail"), "a@b.com");
    await user.type(screen.getByLabelText("Passwort"), "secret123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/auth/login", { email: "a@b.com", password: "secret123" })
    );
  });

  it("shows an error message when login fails", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(401, "Invalid credentials"));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("E-Mail"), "a@b.com");
    await user.type(screen.getByLabelText("Passwort"), "wrong");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));

    await waitFor(() => expect(screen.getByText("Invalid credentials")).toBeInTheDocument());
  });

  it("shows the 2FA code step when login reports twoFactorRequired, then completes it", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ twoFactorRequired: true, tempToken: "temp-token-123" });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("E-Mail"), "a@b.com");
    await user.type(screen.getByLabelText("Passwort"), "secret123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Code aus der Authenticator-App")).toBeInTheDocument()
    );

    vi.mocked(api.post).mockResolvedValueOnce({ id: "1", email: "a@b.com", name: "A", role: "OWNER" });
    await user.type(screen.getByLabelText("Code aus der Authenticator-App"), "123456");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/auth/2fa/verify-login", {
        tempToken: "temp-token-123",
        token: "123456",
      })
    );
  });

  it("switches to backup-code entry and submits backupCode instead of token", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ twoFactorRequired: true, tempToken: "temp-token-123" });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("E-Mail"), "a@b.com");
    await user.type(screen.getByLabelText("Passwort"), "secret123");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(screen.getByText("Stattdessen Backup-Code verwenden")).toBeInTheDocument());

    await user.click(screen.getByText("Stattdessen Backup-Code verwenden"));
    vi.mocked(api.post).mockResolvedValueOnce({ id: "1", email: "a@b.com", name: "A", role: "OWNER" });
    await user.type(screen.getByLabelText("Backup-Code"), "abc123");
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/auth/2fa/verify-login", {
        tempToken: "temp-token-123",
        backupCode: "abc123",
      })
    );
  });
});
