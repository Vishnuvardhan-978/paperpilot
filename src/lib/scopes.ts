export type AskScope = "docs" | "library" | "open";

export const SCOPES: {
  id: AskScope;
  label: string;
  short: string;
}[] = [
  { id: "docs", label: "This chat", short: "Only attached sources" },
  { id: "library", label: "Library", short: "All your past uploads" },
  { id: "open", label: "Open tutor", short: "Teach beyond any file" },
];

export const OPEN_TUTOR_CHIPS = [
  "Explain gravity like I'm new to science",
  "Help me plan a study schedule for exams",
  "Quiz me on world capitals (easy)",
  "What should I practice to get better at writing?",
];

export const LIBRARY_CHIPS = [
  "What themes appear across my library?",
  "Make a revision plan from everything I've uploaded",
  "Which of my sources mention deadlines or dates?",
  "Connect ideas across my past documents",
];
