import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El system prompt de Claudia se lee de prompts/ en runtime: incluirlo en el bundle de las funciones.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**"],
  },
};

export default nextConfig;
