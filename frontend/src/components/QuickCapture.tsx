import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

export default function QuickCapture() {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
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
    <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Neue Idee oder Aufgabe erfassen… (Taste „n“ fokussiert dieses Feld, Enter speichert)"
        className="flex-1 border rounded-lg px-4 py-3 text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      <button
        type="button"
        onClick={() => (isListening ? stop() : start())}
        disabled={!isSupported}
        title={isSupported ? "Spracheingabe" : "Spracheingabe nicht unterstützt"}
        className={`px-4 rounded-lg border shadow-sm ${
          isListening ? "bg-red-600 text-white border-red-600" : "bg-white hover:bg-gray-100"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        🎤
      </button>
    </form>
  );
}
