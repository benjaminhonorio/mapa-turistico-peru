// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://benjaminhonorio.github.io",
  base: "/mapa-turistico-peru",
  trailingSlash: "ignore",
  vite: {
    // MapLibre carga su worker con new URL(..., import.meta.url): no prebundlear
    optimizeDeps: { exclude: ["maplibre-gl"] },
    worker: { format: "es" },
  },
});
