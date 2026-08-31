import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import ScanCapture from "./ScanCapture";

export default function QuickCapture() {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // The command palette's "Neue Idee erfassen" navigates here with
  // ?focus=capture so the input is focused right away, same as pressing "n".
  useEffect(() => {
    if (searchParams.get("focus") === "capture") {
      inputRef.current?.focus();
      searchParams.delete("focus");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const { isSupported, isListening, transcript, start, stop } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) setTitle(transcript);
  }, [transcript]);

  const createItem = useMutation({
    mutationFn: (title: string) => api.post("/items", { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setTitle("");
    },
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = ["INPUT", "TEXTAREA"].includes(target.tagName);
      if (e.key === "n" && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    createItem.mutate(title.trim());
  }

  return (
    <div className="mb-6 flex gap-2">
      {/* Only the title input lives in the <form>: browsers only submit on
          Enter implicitly when there's exactly one text field in the form,
          so the file input inside ScanCapture must stay outside it. */}
      <form onSubmit={handleSubmit} className="flex-1 min-w-0">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Neue Idee oder Aufgabe erfassen… (Taste „n“ fokussiert dieses Feld, Enter speichert)"
          className="w-full border rounded-lg px-4 py-3 min-h-[48px] text-base sm:text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </form>
      <button
        type="button"
        onClick={() => (isListening ? stop() : start())}
        disabled={!isSupported}
        title={isSupported ? "Spracheingabe" : "Spracheingabe nicht unterstützt"}
        className={`shrink-0 w-12 h-12 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border shadow-sm text-lg ${
          isListening ? "bg-red-600 text-white border-red-600" : "bg-white hover:bg-gray-100"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        🎤
      </button>
      <ScanCapture />
    </div>
  );
}
