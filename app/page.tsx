"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import { useProjects } from "./hooks/useProjects";
import { saveScreenImages, loadScreenImages, deleteScreenImages } from "./hooks/useScreenImages";
import { FORMAT_OPTIONS, CONTEXT_SUGGESTIONS } from "./types";
import type { Format, InputMode } from "./types";

// ── Helpers ──

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "");
}

/** Remove leading/trailing markdown code fences that Gemini sometimes adds */
function stripCodeFences(text: string): string {
  return text
    .replace(/^```[\w]*\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/** Return a user-safe error message — don't expose API URLs or model details */
function sanitizeError(msg: string): string {
  if (
    /googleapis|generativelanguage|gemini|anthropic|api[\s_-]?key|https?:\/\//i.test(msg)
  ) {
    return "The AI service returned an error. Please make sure your image is a valid screenshot and try again.";
  }
  return msg;
}

/** Check file magic bytes to confirm it's really an image, not a renamed text file */
async function validateImageBytes(file: File): Promise<boolean> {
  try {
    const buf = await file.slice(0, 12).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true; // GIF
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WebP
    if (b[0] === 0x42 && b[1] === 0x4d) return true; // BMP
  } catch {
    return false;
  }
  return false;
}

/**
 * Detect test case heading lines. Only matches real TC titles, NOT numbered steps.
 * Matches:
 *   "TC-001: ...", "TC001 ...", "1. TC-001: ..."
 *   "Test Case 1: ...", "Test Case 001: ..."
 *   "1. Test Case 1: ..." (numbered + "Test Case")
 * Does NOT match:
 *   "1. Tap the button" (that's a step, not a heading)
 */
function isTestCaseHeading(line: string): boolean {
  const trimmed = line.trim();
  // TC-style IDs anywhere in the line: "TC-001", "TC001", "TC_001"
  if (/^(\d+[\.\)]\s*)?TC[-_]?\d+/i.test(trimmed)) return true;
  // "Test Case 1" pattern (with optional leading number)
  if (/^(\d+[\.\)]\s*)?Test\s*Case\s*\d+/i.test(trimmed)) return true;
  return false;
}

function parsePlainTextSections(text: string): { title: string; body: string }[] {
  const clean = stripMarkdown(text);
  const lines = clean.split("\n");
  const sections: { title: string; body: string }[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (isTestCaseHeading(line)) {
      if (currentTitle || currentLines.length > 0) {
        sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
      }
      currentTitle = line.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentTitle || currentLines.length > 0) {
    sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
  }
  return sections.filter((s) => s.title || s.body);
}

function formatBody(body: string): { type: "bullet" | "text"; content: string }[] {
  return body.split("\n").map((line) => {
    const bulletMatch = line.match(/^(\s*)[*\-]\s+(.*)/);
    if (bulletMatch) return { type: "bullet" as const, content: bulletMatch[2] };
    return { type: "text" as const, content: line };
  });
}

/** Parse Gherkin text into Feature + Scenarios */
function parseGherkinSections(text: string): { title: string; body: string }[] {
  const clean = stripMarkdown(text);
  const sections: { title: string; body: string }[] = [];
  // Split on "Scenario:" or "Scenario Outline:" lines
  const parts = clean.split(/^(?=\s*Scenario(?:\s+Outline)?:)/im);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline === -1) {
      sections.push({ title: trimmed, body: "" });
    } else {
      sections.push({
        title: trimmed.slice(0, firstNewline).trim(),
        body: trimmed.slice(firstNewline + 1).trim(),
      });
    }
  }
  return sections;
}

/** Parse markdown table into header + rows */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  const clean = stripMarkdown(text);
  const lines = clean.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return null;

  const parseRow = (line: string) =>
    line.split("|").slice(1, -1).map((cell) =>
      cell.trim().replace(/<br\s*\/?>/gi, "\n")  // render <br> as actual newlines
    );

  // Strip trailing empty header columns (Gemini sometimes adds a trailing |)
  let headers = parseRow(lines[0]);
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();

  // Skip separator row (|---|---|...)
  const startIdx = lines[1].match(/^[|\s\-:]+$/) ? 2 : 1;
  // Normalize each row to exactly headers.length cells
  const rows = lines.slice(startIdx).map((line) => {
    const cells = parseRow(line);
    while (cells.length < headers.length) cells.push("");
    return cells.slice(0, headers.length);
  });

  if (headers.length === 0) return null;
  return { headers, rows };
}

/** Resize an image data-url to a small thumbnail */
function createThumbnail(dataUrl: string, maxSize = 80): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.src = dataUrl;
  });
}

// ── Main Component ──

export default function Home() {
  const pm = useProjects();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : false
  );

  // Per-session generate state (not persisted)
  const [inputMode, setInputMode] = useState<InputMode>("upload");
  const [format, setFormat] = useState<Format>("plain");
  const [context, setContext] = useState("");
  const [images, setImages] = useState<{ base64: string; mediaType: string; preview: string }[]>([]);
  const [figmaUrl, setFigmaUrl] = useState("");
  const [figmaToken, setFigmaToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingFigma, setLoadingFigma] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSection, setCopiedSection] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // When selecting a screen, load saved results and images
  useEffect(() => {
    if (pm.activeScreen) {
      if (pm.activeScreen.result) {
        setResult(pm.activeScreen.result);
        setFormat(pm.activeScreen.format);
        setContext(pm.activeScreen.context);
        setWordCount(pm.activeScreen.result.trim().split(/\s+/).filter(Boolean).length);
      } else {
        setResult(null);
        setContext(pm.activeScreen.context || "");
        setWordCount(0);
      }
      setError(null);
      // Load saved images from IndexedDB
      loadScreenImages(pm.activeScreen.id)
        .then((saved) => setImages(saved))
        .catch(() => setImages([]));
    } else {
      // No screen selected — clear everything so previous screen's context doesn't bleed into next generation
      setImages([]);
      setContext("");
      setResult(null);
      setWordCount(0);
      setError(null);
    }
  }, [pm.activeScreenId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save images to IndexedDB whenever they change (if a screen is selected)
  const imagesLoadedRef = useRef(false);
  useEffect(() => {
    // Skip the first render after screen switch (that's the load, not a user change)
    if (!imagesLoadedRef.current) {
      imagesLoadedRef.current = true;
      return;
    }
    if (pm.activeScreenId) {
      saveScreenImages(pm.activeScreenId, images).catch(() => {});
    }
  }, [images, pm.activeScreenId]);

  // Reset the loaded flag when screen changes
  useEffect(() => {
    imagesLoadedRef.current = false;
  }, [pm.activeScreenId]);

  const handleFiles = async (files: FileList | File[]) => {
    const candidates = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (candidates.length === 0) {
      setError("Please upload image files (PNG, JPG, WEBP, GIF)");
      return;
    }

    // Validate magic bytes so renamed text files are rejected
    const checked = await Promise.all(
      candidates.map(async (file) => ({ file, valid: await validateImageBytes(file) }))
    );
    const validFiles = checked.filter((c) => c.valid).map((c) => c.file);
    const invalidNames = checked.filter((c) => !c.valid).map((c) => `"${c.file.name}"`);

    if (invalidNames.length > 0) {
      setError(`${invalidNames.join(", ")} ${invalidNames.length === 1 ? "is" : "are"} not a valid image file — please upload a real PNG, JPG, WEBP, or GIF.`);
      if (validFiles.length === 0) return;
    } else {
      setError(null);
    }

    setResult(null);
    setWordCount(0);

    // Read all valid files then update state once (keeps order stable)
    const newImages = await Promise.all(
      validFiles.map((file) =>
        new Promise<{ base64: string; mediaType: string; preview: string }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            resolve({ base64: dataUrl.split(",")[1], mediaType: file.type, preview: dataUrl });
          };
          reader.readAsDataURL(file);
        })
      )
    );
    setImages((prev) => [...prev, ...newImages]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files).catch(() => {});
  };

  const removeImage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAllImages = (e: React.MouseEvent) => {
    e.stopPropagation();
    setImages([]);
    setResult(null);
    setError(null);
    setWordCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFigmaLoad = async () => {
    if (!figmaUrl || !figmaToken) {
      setError("Please enter both a Figma URL and your Figma access token");
      return;
    }
    setError(null);
    setLoadingFigma(true);
    try {
      const res = await fetch("/api/figma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl, figmaToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch Figma design");
      setImages((prev) => [
        ...prev,
        { base64: data.imageBase64, mediaType: data.mediaType, preview: `data:${data.mediaType};base64,${data.imageBase64}` },
      ]);
      setResult(null);
      setWordCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Figma design");
    } finally {
      setLoadingFigma(false);
    }
  };

  const handleGenerate = async () => {
    if (images.length === 0) {
      setError("Please upload at least one image or load a Figma design first");
      return;
    }
    setError(null);
    setResult(null);
    setWordCount(0);
    setLoading(true);

    try {
      // Send all images — API receives an array; falls back to single image fields for backward compat
      const payload = images.length === 1
        ? { imageBase64: images[0].base64, mediaType: images[0].mediaType, format, context }
        : { images: images.map((img) => ({ imageBase64: img.base64, mediaType: img.mediaType })), format, context };

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Analysis failed");
      }

      if (format === "excel" && res.headers.get("content-type")?.includes("spreadsheetml")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "test-cases.xlsx";
        a.click();
        URL.revokeObjectURL(url);
        setResult("__excel_downloaded__");
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setResult(accumulated);
        setWordCount(accumulated.trim().split(/\s+/).filter(Boolean).length);
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      }

      // Strip code fences that Gemini adds to JSON output
      if (format === "json") {
        accumulated = stripCodeFences(accumulated);
        setResult(accumulated);
        setWordCount(accumulated.trim().split(/\s+/).filter(Boolean).length);
      }

      // Save to screen if one is selected
      if (pm.activeProjectId && pm.activeScreenId && accumulated) {
        const thumb = images.length > 0 ? await createThumbnail(images[0].preview) : null;
        pm.saveScreenResult(pm.activeProjectId, pm.activeScreenId, accumulated, format, context, thumb);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to generate test cases";
      setError(sanitizeError(raw));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result || result === "__excel_downloaded__") return;
    const text = format === "json" ? stripCodeFences(result) : stripMarkdown(result);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopySection = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(index);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleDownloadText = () => {
    if (!result || result === "__excel_downloaded__") return;
    const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
    let cleanResult = format === "plain" ? stripMarkdown(result) : result;
    if (format === "json") cleanResult = stripCodeFences(cleanResult);
    const blob = new Blob([cleanResult], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Name the file after project + screen if available
    const slug = [pm.activeProject?.name, pm.activeScreen?.name]
      .filter(Boolean)
      .join("-")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim() || "test-cases";
    a.download = `${slug}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Export all screens in a project to one Excel file ──
  const handleExportProject = useCallback(async (projectId: string) => {
    const project = pm.projects.find((p) => p.id === projectId);
    if (!project) return;

    const screensWithResults = project.screens.filter((s) => s.result && s.result !== "__excel_downloaded__");
    if (screensWithResults.length === 0) return;

    // Dynamically import xlsx
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    for (const screen of screensWithResults) {
      const clean = stripMarkdown(screen.result!);
      const sections = parsePlainTextSections(clean);

      // Build rows: TC ID, Title, Details
      const rows = sections.map((s) => ({
        "Test Case": s.title || "",
        "Details": s.body || "",
      }));

      // If no parseable sections, put raw text in one row
      if (rows.length === 0) {
        rows.push({ "Test Case": "All", "Details": clean });
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      // Set column widths
      ws["!cols"] = [{ wch: 40 }, { wch: 80 }];
      // Sheet name max 31 chars
      const sheetName = screen.name.slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9-_ ]/g, "")}-test-cases.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [pm.projects]);

  const isExcelDownloaded = result === "__excel_downloaded__";
  const hasResult = !!result && !isExcelDownloaded;
  const canGenerate = images.length > 0 && !loading;

  // Whether we're in "project mode" (screen selected) or "quick mode" (no project)
  const screenLabel = pm.activeScreen?.name ?? null;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #f0fdf4 100%)" }}>

      {/* Header */}
      <header className="border-b border-white/60 backdrop-blur-sm sticky top-0 z-20" style={{ background: "rgba(255,255,255,0.85)" }}>
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 tracking-tight">TestCraft AI</h1>
              <p className="text-xs text-gray-400">
                {screenLabel
                  ? <><span className="text-violet-500 font-medium">{pm.activeProject?.name}</span> / {screenLabel}</>
                  : "Generate test cases from UI designs"
                }
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400 bg-white rounded-full px-3 py-1.5 border border-gray-100 shadow-sm">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
            Powered by Gemini AI
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-10 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <Sidebar
            projects={pm.projects}
            activeProjectId={pm.activeProjectId}
            activeScreenId={pm.activeScreenId}
            onSelectProject={(id) => pm.setActiveProjectId(id)}
            onSelectScreen={(_, screenId) => pm.setActiveScreenId(screenId)}
            onAddProject={pm.addProject}
            onRenameProject={pm.renameProject}
            onDeleteProject={(projectId) => {
              const project = pm.projects.find((p) => p.id === projectId);
              if (project) {
                project.screens.forEach((s) => deleteScreenImages(s.id).catch(() => {}));
              }
              pm.deleteProject(projectId);
            }}
            onAddScreen={pm.addScreen}
            onRenameScreen={pm.renameScreen}
            onDeleteScreen={(projectId, screenId) => {
              deleteScreenImages(screenId).catch(() => {});
              pm.deleteScreen(projectId, screenId);
            }}
            onExportProject={handleExportProject}
            onDeselectScreen={() => pm.setActiveScreenId(null)}
          />
        )}

        {/* Main content */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {/* Contextual banner when a screen is selected */}
          {pm.activeScreen && (
            <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
              <div className="flex items-center gap-2 text-sm bg-violet-50 border border-violet-100 rounded-xl px-4 py-2.5">
                <svg className="w-4 h-4 text-violet-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-violet-700">
                  Generating for <span className="font-semibold">{pm.activeScreen.name}</span>
                  {pm.activeScreen.result && <span className="text-violet-400 ml-2">— has saved test cases (re-generate to update)</span>}
                </span>
              </div>
            </div>
          )}

          {/* Hero — only show when no screen is selected */}
          {!pm.activeScreen && (
            <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-6 sm:pt-10 pb-6 text-center">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-3 py-1 mb-4">
                ✨ AI-Powered QA Assistant
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                Turn designs into test cases{" "}
                <span style={{ background: "linear-gradient(90deg, #6366f1, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  instantly
                </span>
              </h2>
              <p className="text-gray-500 text-sm max-w-xl mx-auto">
                Upload a screenshot or connect Figma — AI analyzes your UI and generates comprehensive test cases in your preferred format.
                Create a project in the sidebar to organize test cases by screen.
              </p>
            </div>
          )}

          <main className={`max-w-7xl mx-auto px-3 sm:px-6 pb-16 grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 ${pm.activeScreen ? "pt-4" : ""}`}>

            {/* ── Left column ── */}
            <div className="lg:col-span-2 space-y-4">

              {/* Input mode toggle */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5 flex gap-1">
                {(["upload", "figma"] as InputMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setInputMode(mode); setError(null); }}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                      inputMode === mode ? "text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                    }`}
                    style={inputMode === mode ? { background: "linear-gradient(135deg, #6366f1, #8b5cf6)" } : {}}
                  >
                    {mode === "upload" ? (
                      <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>Upload Image</>
                    ) : (
                      <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 2C4.34 2 3 3.34 3 5v14c0 1.66 1.34 3 3 3h12c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3H6zm0 2h12c.55 0 1 .45 1 1v14c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1V5c0-.55.45-1 1-1zm4 3v4H7l5 5 5-5h-3V7h-4z"/></svg>Figma URL</>
                    )}
                  </button>
                ))}
              </div>

              {/* Upload zone */}
              {inputMode === "upload" && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  {/* Drop zone / empty state */}
                  <div
                    className={`border-2 border-dashed transition-all duration-200 cursor-pointer rounded-2xl ${
                      dragging ? "border-violet-400 bg-violet-50 scale-[1.005]" : images.length > 0 ? "border-transparent" : "border-gray-200 hover:border-violet-300 hover:bg-violet-50/30"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {images.length === 0 && (
                      <div className="p-10 text-center">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                          <svg className="w-7 h-7 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-sm font-semibold text-gray-700 mb-1">Drop your designs here</p>
                        <p className="text-xs text-gray-400">or click to browse — select multiple files</p>
                        <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-violet-600 font-medium bg-violet-50 px-3 py-1.5 rounded-full border border-violet-100">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          Click to upload
                        </div>
                      </div>
                    )}

                    {/* Image gallery */}
                    {images.length > 0 && (
                      <div className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-2 px-1">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {images.length} screenshot{images.length !== 1 ? "s" : ""}
                          </span>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                              className="text-xs font-medium text-violet-600 hover:text-violet-700 flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                              Add more
                            </button>
                            <button
                              onClick={clearAllImages}
                              className="text-xs font-medium text-gray-400 hover:text-red-500 flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              Clear all
                            </button>
                          </div>
                        </div>
                        <div className={`grid gap-2 ${images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                          {images.map((img, i) => (
                            <div key={i} className="relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                              <img src={img.preview} alt={`Screenshot ${i + 1}`} className="w-full object-contain h-32 bg-gray-50" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                                <button
                                  onClick={(e) => removeImage(i, e)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity bg-white text-red-500 rounded-full p-1.5 shadow-lg"
                                  title="Remove"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                              <div className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded-md font-medium">
                                {i + 1}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => { if (e.target.files && e.target.files.length > 0) { handleFiles(e.target.files).catch(() => {}); e.target.value = ""; } }} />
                </div>
              )}

              {/* Figma inputs */}
              {inputMode === "figma" && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Figma URL</label>
                    <input type="url" value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)}
                      placeholder="https://www.figma.com/design/..."
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-all placeholder:text-gray-400" />
                    <p className="text-xs text-gray-400 mt-1">Add ?node-id=... to target a specific frame</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Personal Access Token</label>
                    <input type="password" value={figmaToken} onChange={(e) => setFigmaToken(e.target.value)}
                      placeholder="figd_..."
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-all placeholder:text-gray-400" />
                    <p className="text-xs text-gray-400 mt-1">Figma → Settings → Security → Personal access tokens</p>
                  </div>
                  <button onClick={handleFigmaLoad} disabled={loadingFigma || !figmaUrl || !figmaToken}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-violet-700 border-violet-200 bg-violet-50 hover:bg-violet-100">
                    {loadingFigma ? (
                      <><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Loading...</>
                    ) : "Load Figma Design"}
                  </button>
                  {images.length > 0 && inputMode === "figma" && (
                    <img src={images[images.length - 1].preview} alt="Figma design" className="w-full rounded-xl object-contain max-h-48 border border-gray-100" />
                  )}
                </div>
              )}

              {/* Context input */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Context
                    <span className="text-gray-400 font-normal normal-case tracking-normal">— optional but recommended</span>
                  </label>
                </div>
                <textarea
                  value={context}
                  onChange={(e) => {
                    const val = e.target.value;
                    setContext(val);
                    // Persist immediately so it survives screen switches
                    if (pm.activeProjectId && pm.activeScreenId) {
                      pm.updateScreenContext(pm.activeProjectId, pm.activeScreenId, val);
                    }
                  }}
                  placeholder="Describe what this screen is for, the user type, or any specific testing requirements..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-all placeholder:text-gray-400 resize-none"
                />
                <div className="mt-2">
                  <p className="text-xs text-gray-400 mb-1.5">Quick fill <span className="text-gray-300">(appends to existing text):</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {CONTEXT_SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => {
                        const val = context.trim() ? context.trim() + " — " + s : s;
                        setContext(val);
                        if (pm.activeProjectId && pm.activeScreenId) {
                          pm.updateScreenContext(pm.activeProjectId, pm.activeScreenId, val);
                        }
                      }}
                        className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-all">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Format selector */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Output Format</p>
                <div className="space-y-2">
                  {FORMAT_OPTIONS.map((opt) => (
                    <label key={opt.value}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150 ${
                        format === opt.value ? "border-violet-300 bg-violet-50" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                      }`}>
                      <input type="radio" name="format" value={opt.value} checked={format === opt.value}
                        onChange={() => setFormat(opt.value)} className="hidden" />
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        format === opt.value ? "border-violet-500" : "border-gray-300"
                      }`}>
                        {format === opt.value && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                      </div>
                      <span className="text-base">{opt.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-800">{opt.label}</span>
                        <span className="text-xs text-gray-400 ml-2">{opt.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="w-full py-3.5 rounded-2xl font-semibold text-white text-sm shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
                style={{ background: canGenerate ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#9ca3af" }}>
                {loading ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generating...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Generate Test Cases</>
                )}
              </button>

              {/* No-screen warning */}
              {!pm.activeScreen && pm.projects.length > 0 && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-3.5 text-sm text-amber-700">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Select a screen from the sidebar to save generated test cases. Without a screen selected, results won't be saved.
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl p-3.5 text-sm text-red-600">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {error}
                </div>
              )}
            </div>

            {/* ── Right column — Output ── */}
            <div className="lg:col-span-3 lg:sticky lg:top-4 lg:self-start">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col" style={{ minHeight: "400px", maxHeight: "min(82vh, 860px)" }}>

                {/* Output toolbar */}
                <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-3.5 border-b border-gray-100 bg-gray-50/50 flex-shrink-0 flex-wrap">
                  <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                    <div className="flex gap-1.5 flex-shrink-0">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    </div>
                    <span className="text-xs font-medium text-gray-500 truncate">
                      {hasResult ? `${FORMAT_OPTIONS.find(f => f.value === format)?.label} Output` : "Output"}
                    </span>
                    {loading && (
                      <span className="hidden sm:inline-flex items-center gap-1 text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-100 flex-shrink-0">
                        <span className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse" />
                        Streaming...
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {wordCount > 0 && (
                      <span className="hidden sm:inline text-xs text-gray-400">{wordCount} words</span>
                    )}
                    {hasResult && (
                      <div className="flex gap-1.5 sm:gap-2">
                        <button onClick={handleCopy}
                          className="flex items-center gap-1 sm:gap-1.5 py-1.5 px-2 sm:px-3 text-xs font-medium rounded-lg border transition-all hover:bg-white"
                          style={copied ? { color: "#16a34a", borderColor: "#bbf7d0", background: "#f0fdf4" } : { color: "#6b7280", borderColor: "#e5e7eb" }}>
                          {copied ? (
                            <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="hidden sm:inline">Copied!</span></>
                          ) : (
                            <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg><span>{["plain", "gherkin", "markdown"].includes(format) ? "Copy All" : "Copy"}</span></>
                          )}
                        </button>
                        <button onClick={handleDownloadText}
                          className="flex items-center gap-1 sm:gap-1.5 py-1.5 px-2 sm:px-3 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-white transition-all">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          Download
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Output body */}
                <div ref={outputRef} className="flex-1 overflow-auto p-3 sm:p-6">

                  {/* Empty state */}
                  {!result && !loading && (
                    <div className="h-full flex flex-col items-center justify-center text-center py-16">
                      <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5" style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                        <svg className="w-10 h-10 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                      </div>
                      <h3 className="text-base font-semibold text-gray-700 mb-2">Ready to generate</h3>
                      <p className="text-sm text-gray-400 max-w-xs mb-8">
                        {pm.activeScreen
                          ? `Upload a screenshot for "${pm.activeScreen.name}" and hit Generate.`
                          : "Upload a UI screenshot or connect Figma, add context, choose your format, and hit Generate."
                        }
                      </p>
                      <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
                        {[
                          { step: "1", label: "Upload design", icon: "🖼️" },
                          { step: "2", label: "Add context", icon: "💬" },
                          { step: "3", label: "Get test cases", icon: "✅" },
                        ].map(({ step, label, icon }) => (
                          <div key={step} className="flex flex-col items-center gap-2">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                              {icon}
                            </div>
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>{step}</div>
                            <p className="text-xs text-gray-400 text-center leading-tight">{label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Loading */}
                  {loading && !result && (
                    <div className="h-full flex flex-col items-center justify-center py-16">
                      <div className="relative w-16 h-16 mb-5">
                        <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
                        <div className="absolute inset-0 rounded-full border-4 border-t-violet-500 animate-spin" />
                        <div className="absolute inset-2 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                          <svg className="w-5 h-5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">Analyzing your design...</p>
                      <p className="text-xs text-gray-400">Results will stream in shortly</p>
                    </div>
                  )}

                  {/* Excel success */}
                  {isExcelDownloaded && (
                    <div className="h-full flex flex-col items-center justify-center py-16">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, #dcfce7, #bbf7d0)" }}>
                        <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-gray-800 mb-1">Excel file downloaded!</p>
                      <p className="text-sm text-gray-400">Check your downloads for test-cases.xlsx</p>
                    </div>
                  )}

                  {/* ── Plain text section cards ── */}
                  {hasResult && format === "plain" && !loading && (() => {
                    const sections = parsePlainTextSections(result!);
                    return (
                      <div className="space-y-4">
                        {sections.map((section, i) => {
                          const sectionText = [section.title, section.body].filter(Boolean).join("\n");
                          const isCopied = copiedSection === i;
                          const bodyLines = section.body ? formatBody(section.body) : [];
                          return (
                            <div key={i} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                              {/* Header bar with title + copy */}
                              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100" style={{ background: "linear-gradient(135deg, #f8f7ff, #f3f1ff)" }}>
                                <span className="text-sm font-semibold text-gray-800 flex-1 min-w-0 truncate">
                                  {section.title || `Section ${i + 1}`}
                                </span>
                                <button
                                  onClick={() => handleCopySection(i, sectionText)}
                                  className={`flex-shrink-0 py-1 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all ${
                                    isCopied
                                      ? "border-green-200 bg-green-50 text-green-600"
                                      : "border-gray-200 bg-white text-gray-500 hover:text-violet-600 hover:border-violet-300"
                                  }`}
                                >
                                  {isCopied ? (
                                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied</>
                                  ) : (
                                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                                  )}
                                </button>
                              </div>
                              {bodyLines.length > 0 && (
                                <div className="px-4 py-3 space-y-1">
                                  {bodyLines.map((line, j) =>
                                    line.type === "bullet" ? (
                                      <div key={j} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
                                        <span className="text-violet-400 mt-0.5 flex-shrink-0">&#8226;</span>
                                        <span>{line.content}</span>
                                      </div>
                                    ) : line.content.trim() ? (
                                      <p key={j} className="text-sm text-gray-600 leading-relaxed">{line.content}</p>
                                    ) : (
                                      <div key={j} className="h-1.5" />
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* ── Gherkin / BDD section cards ── */}
                  {hasResult && format === "gherkin" && !loading && (() => {
                    const sections = parseGherkinSections(result!);
                    return (
                      <div className="space-y-4">
                        {sections.map((section, i) => {
                          const sectionText = [section.title, section.body].filter(Boolean).join("\n");
                          const isCopied = copiedSection === i;
                          const isFeature = /^Feature:/i.test(section.title);
                          return (
                            <div key={i} className={`border rounded-xl overflow-hidden bg-white shadow-sm ${isFeature ? "border-violet-200" : "border-gray-200"}`}>
                              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isFeature ? "border-violet-100" : "border-gray-100"}`}
                                style={{ background: isFeature ? "linear-gradient(135deg, #ede9fe, #ddd6fe)" : "linear-gradient(135deg, #f0fdf4, #dcfce7)" }}>
                                <span className={`text-sm font-semibold flex-1 min-w-0 truncate ${isFeature ? "text-violet-800" : "text-green-800"}`}>
                                  {section.title || `Section ${i + 1}`}
                                </span>
                                <button
                                  onClick={() => handleCopySection(i, sectionText)}
                                  className={`flex-shrink-0 py-1 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all ${
                                    isCopied
                                      ? "border-green-200 bg-green-50 text-green-600"
                                      : "border-gray-200 bg-white text-gray-500 hover:text-violet-600 hover:border-violet-300"
                                  }`}
                                >
                                  {isCopied ? (
                                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied</>
                                  ) : (
                                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
                                  )}
                                </button>
                              </div>
                              {section.body && (
                                <div className="px-4 py-3">
                                  <pre className="text-sm text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">{section.body}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* ── Markdown table ── */}
                  {hasResult && format === "markdown" && !loading && (() => {
                    const table = parseMarkdownTable(result!);
                    if (!table) return (
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{stripMarkdown(result!)}</pre>
                    );
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr>
                              {table.headers.map((h, hi) => (
                                <th key={hi} className="text-left px-3 py-2.5 text-xs font-semibold text-violet-700 uppercase tracking-wide border-b-2 border-violet-200 bg-violet-50/50">
                                  {h}
                                </th>
                              ))}
                              <th className="w-16 border-b-2 border-violet-200 bg-violet-50/50" />
                            </tr>
                          </thead>
                          <tbody>
                            {table.rows.map((row, ri) => {
                              const isCopied = copiedSection === ri;
                              const rowText = table.headers.map((h, hi) => `${h}: ${row[hi] || ""}`).join("\n");
                              return (
                                <tr key={ri} className="border-b border-gray-100 hover:bg-violet-50/20 transition-colors group">
                                  {row.map((cell, ci) => (
                                    <td key={ci} className="px-3 py-2.5 text-gray-700 align-top whitespace-pre-line">
                                      {cell}
                                    </td>
                                  ))}
                                  <td className="px-2 py-2.5 align-top">
                                    <button
                                      onClick={() => handleCopySection(ri, rowText)}
                                      className={`opacity-0 group-hover:opacity-100 py-1 px-2 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all ${
                                        isCopied
                                          ? "opacity-100 border-green-200 bg-green-50 text-green-600"
                                          : "border-gray-200 bg-white text-gray-400 hover:text-violet-600 hover:border-violet-300"
                                      }`}
                                    >
                                      {isCopied ? (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                      ) : (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                      )}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {/* Streaming output OR JSON format (raw pre) */}
                  {hasResult && loading && (
                    <div className="relative">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                        {format === "plain" ? stripMarkdown(result!) : result}
                        <span className="inline-block w-2 h-4 bg-violet-500 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
                      </pre>
                    </div>
                  )}
                  {hasResult && !loading && format === "json" && (
                    <div className="relative">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{result}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
