/** @type {import('next').NextConfig} */
const nextConfig = {
  // Justin's photo can live on any host, so allow remote images everywhere.
  // Tighten this to your own domain if you prefer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // rivetkit ships native binaries + WASM; it must be required from
  // node_modules at runtime, not bundled (used by /api/rivet, the
  // serverless runner route).
  serverExternalPackages: ["rivetkit"],
};

export default nextConfig;
