import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Inbox from "./Inbox";
import { api } from "../lib/api";
import { Item } from "../lib/types";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
    },
    bulkUpdateItems: vi.fn().mockResolvedValue({ updated: [], skipped: [] }),
    bulkDeleteItems: vi.fn().mockResolvedValue({ deletedIds: [], skipped: [] }),
  };
});

const items: Item[] = [
  {
    id: "item-1",
    type: "IDEA",
    title: "Erste Idee",
    description: null,
    status: "INBOX",
    important: false,
    urgent: false,
    dueDate: null,
    waitingSince: null,
    source: "MANUAL",
    createdById: "u1",
    assignedToId: null,
    googleEventId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "item-2",
    type: "IDEA",
    title: "Zweite Idee",
    description: null,
    status: "INBOX",
    important: false,
    urgent: false,
    dueDate: null,
    waitingSince: null,
    source: "MANUAL",
    createdById: "u1",
    assignedToId: null,
    googleEventId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Inbox />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Inbox bulk selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/items?status=INBOX") return items;
      if (path === "/users") return [];
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("shows the action bar with a correct selection count once items are checked", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Erste Idee")).toBeInTheDocument());
    expect(screen.queryByText(/ausgewählt/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Erste Idee auswählen"));
    await user.click(screen.getByLabelText("Zweite Idee auswählen"));

    expect(screen.getByText("2 ausgewählt")).toBeInTheDocument();
  });

  it("calls bulkUpdateItems with the selected ids and DONE status when archiving", async () => {
    const { bulkUpdateItems } = await import("../lib/api");
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Erste Idee")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Erste Idee auswählen"));
    await user.click(screen.getByRole("button", { name: "Archivieren" }));

    await waitFor(() =>
      expect(bulkUpdateItems).toHaveBeenCalledWith(["item-1"], { status: "DONE" })
    );
  });

  it("selects all visible items via the 'Alle auswählen' checkbox", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Erste Idee")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Alle auswählen"));

    expect(screen.getByText("2 ausgewählt")).toBeInTheDocument();
  });
});
