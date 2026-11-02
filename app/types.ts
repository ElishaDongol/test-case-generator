export type Format = "plain" | "json" | "gherkin" | "markdown" | "excel";
export type InputMode = "upload" | "figma";

export interface Screen {
  id: string;
  name: string;
  /** Generated test cases (raw text from the AI) */
  result: string | null;
  /** Which format was used to generate */
  format: Format;
  /** Context the user provided */
  context: string;
  /** Small thumbnail data-url for the sidebar (resized) */
  thumbnail: string | null;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  screens: Screen[];
  createdAt: number;
}

export const FORMAT_OPTIONS: { value: Format; label: string; icon: string; description: string }[] = [
  { value: "plain", label: "Plain Text", icon: "📝", description: "Numbered list" },
  { value: "json", label: "JSON", icon: "{ }", description: "Structured data" },
  { value: "gherkin", label: "Gherkin / BDD", icon: "🥒", description: "Given/When/Then" },
  { value: "markdown", label: "Markdown Table", icon: "📊", description: "Table format" },
  { value: "excel", label: "Excel (.xlsx)", icon: "📗", description: "Download file" },
];

export const CONTEXT_SUGGESTIONS = [
  "Login page for a banking app",
  "E-commerce checkout flow",
  "User profile settings screen",
  "Mobile onboarding screens",
  "Admin dashboard with data tables",
];
