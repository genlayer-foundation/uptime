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
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
  {
    title: "Monitor an API",
    description: "Call a JSON endpoint and record its status and the value you care about, as the validators agreed it.",
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
  {
    title: "Monitor an Intelligent Contract",
    description: "Read an Intelligent Contract view on GenLayer, with no transaction, and track how the value moves.",
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
  {
    title: "Monitor an AI answer",
    description: "Ask an LLM a question, optionally about a page it reads first, and keep the short answer validators agree on.",
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
  {
    title: "Call an Intelligent Contract on a schedule",
    description: "Call any method on your Intelligent Contract, then optionally read a view to record the result.",
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
  {
    title: "Schedule a deploy",
    description: "Deploy the same Intelligent Contract source on schedule, pinned by hash when you create the job.",
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
  {
    title: "Deploy, then call",
    description: "Deploy every X, and call the latest accepted deploy every Y.",
    networks: "GenLayer Studio · GenLayer Testnet Bradbury",
  },
];
