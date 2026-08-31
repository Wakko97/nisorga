import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, apiUpload, ApiError } from "../lib/api";
import { Item } from "../lib/types";

type Stage = "idle" | "recognizing" | "ready" | "saving";

const MAX_TITLE_LENGTH = 80;

/** First ~80 chars of the OCR text, newlines collapsed to spaces, for use as a title suggestion. */
function suggestTitle(ocrText: string): string {
  const normalized = ocrText.replace(/\s+/g, " ").trim();
  return normalized.slice(0, MAX_TITLE_LENGTH);
}

export default function ScanCapture() {
  const [stage, setStage] = useState<Stage>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function reset() {
    setStage("idle");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setTitle("");
    setOcrText("");
    setError(null);
    fileRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    fileRef.current = file;
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setStage("recognizing");

    try {
      // Dynamically imported so tesseract.js is not part of the initial
      // app bundle — it is only fetched when the user actually scans.
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("deu");
      try {
        const {
          data: { text },
        } = await worker.recognize(file);
        setOcrText(text);
        setTitle(suggestTitle(text) || "Scan");
      } finally {
        await worker.terminate();
      }
      setStage("ready");
    } catch (err) {
      console.error("OCR failed", err);
      // OCR failing should never block saving the photo — fall back to a
      // manual title instead of a dead end.
      setError("Texterkennung fehlgeschlagen. Du kannst den Titel manuell eingeben.");
      setTitle("Scan");
      setStage("ready");
    }
  }

  async function handleSave() {
    const file = fileRef.current;
    if (!file || !title.trim()) return;

    setStage("saving");
    setError(null);
    try {
      const item = await api.post<Item>("/items", {
        title: title.trim(),
        description: ocrText.trim() || null,
        source: "SCAN",
      });
      await apiUpload(`/items/${item.id}/attachment`, file);
      queryClient.invalidateQueries({ queryKey: ["items"] });
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Speichern fehlgeschlagen");
      setStage("ready");
    }
  }

  if (stage === "idle") {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelected}
          className="hidden"
          data-testid="scan-file-input"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Foto scannen"
          aria-label="Foto scannen"
          className="shrink-0 w-12 h-12 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border bg-white shadow-sm text-lg hover:bg-gray-100"
        >
          📷
        </button>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-4">
        <h2 className="font-semibold mb-3">Scan erfassen</h2>
        {previewUrl && (
          <img src={previewUrl} alt="Aufgenommenes Foto" className="w-full max-h-64 object-contain rounded border mb-3" />
        )}

        {stage === "recognizing" && <p className="text-sm text-gray-600 mb-3">Wird erkannt…</p>}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {(stage === "ready" || stage === "saving") && (
          <>
            <label className="block text-sm text-gray-600 mb-1" htmlFor="scan-title">
              Titel-Vorschlag (bearbeitbar)
            </label>
            <input
              id="scan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-3 text-sm"
              disabled={stage === "saving"}
            />
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={stage === "saving"}
            className="text-sm px-3 py-1.5 rounded border hover:bg-gray-100 disabled:opacity-40"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={stage !== "ready" || !title.trim()}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white disabled:opacity-40"
          >
            {stage === "saving" ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
