import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import QuickCapture from "./QuickCapture";
import { api } from "../lib/api";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({}),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../hooks/useSpeechRecognition");

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <QuickCapture />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("QuickCapture", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useSpeechRecognition).mockReturnValue({
      isSupported: true,
      isListening: false,
      transcript: "",
      start: vi.fn(),
      stop: vi.fn(),
    });
  });

  it("submits only the title on enter, with no other required field blocking it", async () => {
    const user = userEvent.setup();
    renderWithClient();

    const input = screen.getByPlaceholderText(/Neue Idee oder Aufgabe erfassen/i);
    await user.type(input, "Neue Idee{Enter}");

    expect(api.post).toHaveBeenCalledWith("/items", { title: "Neue Idee" });
  });

  it("queues the item locally when offline (network error) instead of losing it", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderWithClient();

    const input = screen.getByPlaceholderText(/Neue Idee oder Aufgabe erfassen/i);
    await user.type(input, "Offline erfasst{Enter}");

    expect(await screen.findByText(/1 offline erfasst, wartet auf Sync/i)).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(JSON.parse(localStorage.getItem("nisorga.offlineQueue.items")!)).toHaveLength(1);
  });

  it("disables the microphone button when speech recognition is not supported", () => {
    vi.mocked(useSpeechRecognition).mockReturnValue({
      isSupported: false,
      isListening: false,
      transcript: "",
      start: vi.fn(),
      stop: vi.fn(),
    });
    renderWithClient();

    const micButton = screen.getByRole("button", { name: "🎤" });
    expect(micButton).toBeDisabled();
  });
});
