import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ItemDetail from "./ItemDetail";
import { api } from "../lib/api";
import { Item } from "../lib/types";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
    },
  };
});

const item: Item = {
  id: "item-1",
  type: "TASK",
  title: "Testaufgabe",
  description: null,
  status: "TODO",
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
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/items/item-1"]}>
        <Routes>
          <Route path="/items/:id" element={<ItemDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ItemDetail", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/items") return [item];
      if (path === "/users") return [];
      if (path.startsWith("/items/") && path.endsWith("/comments")) return [];
      if (path === "/integrations/google/status") return { connected: false };
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("calls api.patch with status WAITING when the status select is set to 'Wartet auf Rückmeldung'", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Testaufgabe")).toBeInTheDocument());

    const statusSelect = screen.getByLabelText("Status");
    await user.selectOptions(statusSelect, "WAITING");

    expect(api.patch).toHaveBeenCalledWith("/items/item-1", { status: "WAITING" });
  });

  it("shows a 'wartet seit' text once the item is WAITING with a waitingSince date", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/items") return [{ ...item, status: "WAITING", waitingSince: new Date().toISOString() }];
      if (path === "/users") return [];
      if (path.startsWith("/items/") && path.endsWith("/comments")) return [];
      if (path === "/integrations/google/status") return { connected: false };
      throw new Error(`unexpected GET ${path}`);
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(/Wartet seit/)).toBeInTheDocument());
  });
});
