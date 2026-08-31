import { describe, it, expect } from "vitest";
import { toCsv } from "../src/lib/csv";

describe("toCsv", () => {
  it("renders a header row followed by one row per input object", () => {
    const csv = toCsv(["a", "b"], [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("treats null/undefined values as empty fields", () => {
    const csv = toCsv(["a", "b"], [{ a: null, b: undefined }]);
    expect(csv).toBe("a,b\r\n,\r\n");
  });

  it("quotes fields containing a comma", () => {
    const csv = toCsv(["a"], [{ a: "one,two" }]);
    expect(csv).toBe('a\r\n"one,two"\r\n');
  });

  it("quotes and doubles embedded quotes", () => {
    const csv = toCsv(["a"], [{ a: 'say "hi"' }]);
    expect(csv).toBe('a\r\n"say ""hi"""\r\n');
  });

  it("quotes fields containing a newline", () => {
    const csv = toCsv(["a"], [{ a: "line one\nline two" }]);
    expect(csv).toBe('a\r\n"line one\nline two"\r\n');
  });

  it("leaves a plain field unquoted", () => {
    const csv = toCsv(["a"], [{ a: "plain" }]);
    expect(csv).toBe("a\r\nplain\r\n");
  });
});
