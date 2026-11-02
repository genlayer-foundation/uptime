// What a job can do. Marketing copy only; mirrors the preset table in the
// repo README ("Uptime contracts" and "Presets that need no contract").
export interface Preset {
  title: string;
  description: string;
  networks: string;
}

export const PRESETS: Preset[] = [
  {
    title: "Check a URL",
    description: "Fetch a page on schedule and record whether it answered, through validator consensus.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Check an API",
    description: "Call a JSON endpoint and record the status and the value you care about.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Ask a question",
    description: "Optionally read a page, ask an LLM a question about it, and keep the short answer.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Call your contract",
    description: "Send a write to any method on your contract, then optionally read a view to record a value.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Read a view",
    description: "Read a view on any contract, no transaction, and track how the value moves.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Deploy your contract",
    description: "Deploy the same source on schedule, pinned by hash when the job is created.",
    networks: "Studio · Bradbury",
  },
  {
    title: "Deploy, then call",
    description: "Deploy every X, and call the latest accepted deploy every Y.",
    networks: "Studio · Bradbury",
  },
];
