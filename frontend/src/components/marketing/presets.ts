// What a job can do. Marketing copy only; mirrors the preset table in the
// repo README ("Uptime contracts" and "Presets that need no contract").
export interface Preset {
  title: string;
  description: string;
  networks: string;
}

export const PRESETS: Preset[] = [
  {
    title: "Monitor a website",
    description: "Check that a page is up, on your schedule. Validators each fetch it and must agree on whether it answered.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Monitor an API",
    description: "Call a JSON endpoint and record its status and the value you care about, as the validators agreed it.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Monitor a smart contract",
    description: "Read a view on any GenLayer contract, with no transaction, and track how the value moves.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Monitor an AI answer",
    description: "Ask an LLM a question, optionally about a page it reads first, and keep the short answer validators agree on.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Call a contract on a schedule",
    description: "Send a write to any method on your contract, then optionally read a view to record the result.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Schedule a deploy",
    description: "Deploy the same contract source on schedule, pinned by hash when you create the job.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Deploy, then call",
    description: "Deploy every X, and call the latest accepted deploy every Y.",
    networks: "Studio · Bradbury",
  },
];
