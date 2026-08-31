import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ScanCapture from "./ScanCapture";
import { api, apiUpload } from "../lib/api";

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
    apiUpload: vi.fn(),
  };
});

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn().mockResolvedValue({
    recognize: vi.fn().mockResolvedValue({ data: { text: "Max Mustermann\nAcme GmbH\n0123 456789" } }),
    terminate: vi.fn().mockResolvedValue(undefined),
  }),
}));

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ScanCapture />
    </QueryClientProvider>
  );
}

function makeFile() {
  return new File(["fake image bytes"], "scan.jpg", { type: "image/jpeg" });
}

describe("ScanCapture", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockResolvedValue({ id: "item-1" });
    vi.mocked(apiUpload).mockResolvedValue({ id: "item-1" });
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("runs OCR on the selected file and puts the recognized text into the title field", async () => {
    const user = renderWithClient() && userEvent.setup();
    const input = screen.getByTestId("scan-file-input") as HTMLInputElement;

    await userEvent.upload(input, makeFile());

    await waitFor(() => expect(screen.getByLabelText(/Titel-Vorschlag/i)).toBeInTheDocument());
    const titleInput = screen.getByLabelText(/Titel-Vorschlag/i) as HTMLInputElement;
    expect(titleInput.value).toBe("Max Mustermann Acme GmbH 0123 456789");
    void user;
  });

  it("saves by creating the item and then uploading the attachment", async () => {
    const user = userEvent.setup();
    renderWithClient();
    const input = screen.getByTestId("scan-file-input") as HTMLInputElement;

    await userEvent.upload(input, makeFile());
    await waitFor(() => expect(screen.getByLabelText(/Titel-Vorschlag/i)).toBeInTheDocument());

    const saveButton = screen.getByRole("button", { name: "Speichern" });
    await user.click(saveButton);

    await waitFor(() => expect(apiUpload).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(
      "/items",
      expect.objectContaining({ title: "Max Mustermann Acme GmbH 0123 456789", source: "SCAN" })
    );
    expect(apiUpload).toHaveBeenCalledWith("/items/item-1/attachment", expect.any(File));
  });
});
