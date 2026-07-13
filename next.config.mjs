/** @type {import('next').NextConfig} */
const nextConfig = {
  // The realtime room runs on PartyKit (separate deploy); the browser reaches
  // it via NEXT_PUBLIC_PARTYKIT_HOST, which Next inlines automatically as a
  // NEXT_PUBLIC_* var — no config needed here.
  //
  // Justin's photo can live on any host, so allow remote images everywhere.
  // Tighten this to your own domain if you prefer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
