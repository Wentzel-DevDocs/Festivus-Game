/** @type {import('next').NextConfig} */
const nextConfig = {
  // Justin's photo can live on any host, so allow remote images everywhere.
  // Tighten this to your own domain if you prefer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
