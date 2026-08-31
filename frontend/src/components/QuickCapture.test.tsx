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
