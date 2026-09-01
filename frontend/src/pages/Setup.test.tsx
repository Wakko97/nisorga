import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Setup from "./Setup";
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
        <Setup />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Setup", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      initialized: false,
      env: { smtpConfigured: false, googleConfigured: false, emailInboundConfigured: false },
    });
  });

  it("submits the owner form to /setup/init and advances to step 3", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "1",
      email: "owner@example.com",
      name: "Owner",
      role: "OWNER",
      emailVerified: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Weiter" }));

    await user.type(screen.getByLabelText("Name"), "Owner");
    await user.type(screen.getByLabelText("E-Mail"), "owner@example.com");
    await user.type(screen.getByLabelText("Passwort"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Owner-Account anlegen" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/setup/init", {
        email: "owner@example.com",
        password: "supersecret",
        name: "Owner",
      })
    );

    await waitFor(() => expect(screen.getByText("Server-Konfiguration")).toBeInTheDocument());
  });

  it("shows an 'already initialized' message on 409", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, "Already initialized"));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Weiter" }));
    await user.type(screen.getByLabelText("Name"), "Owner");
    await user.type(screen.getByLabelText("E-Mail"), "owner@example.com");
    await user.type(screen.getByLabelText("Passwort"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Owner-Account anlegen" }));

    await waitFor(() =>
      expect(screen.getByText(/bereits eingerichtet/)).toBeInTheDocument()
    );
  });

  it("shows the server-config checklist based on GET /setup/status", async () => {
    vi.mocked(api.get).mockResolvedValue({
      initialized: false,
      env: { smtpConfigured: true, googleConfigured: false, emailInboundConfigured: false },
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "1",
      email: "owner@example.com",
      name: "Owner",
      role: "OWNER",
      emailVerified: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Weiter" }));
    await user.type(screen.getByLabelText("Name"), "Owner");
    await user.type(screen.getByLabelText("E-Mail"), "owner@example.com");
    await user.type(screen.getByLabelText("Passwort"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Owner-Account anlegen" }));

    await waitFor(() => expect(screen.getByText("E-Mail-Versand (SMTP)")).toBeInTheDocument());
    expect(screen.getByText("Google Kalender")).toBeInTheDocument();
    expect(screen.getByText(/E-Mail-Eingang/)).toBeInTheDocument();
  });
});
