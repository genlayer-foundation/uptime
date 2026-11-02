import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bradbury Heartbeat fixtures (public/heartbeat/*) are frozen: the contract
  // fetches them and pins card.png's hash. Serve them as immutable.
  async headers() {
    return [
      {
        source: "/heartbeat/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
