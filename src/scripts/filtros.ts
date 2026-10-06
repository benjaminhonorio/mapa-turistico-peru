// Estado de filtros y su sincronización con la URL

import { normalizar, ORDEN_CATEGORIAS, type Recurso } from "./data";

export interface Filtros {
  q: string;
  categorias: Set<number>;
  region: string;
  jerarquiaMin: number;
  actividad: number; // índice en el diccionario, -1 = todas
  libre: boolean;
  zona: boolean;
}

export interface Limites {
  oeste: number;
  sur: number;
  este: number;
  norte: number;
}

export function filtrosVacios(): Filtros {
  return {
    q: "",
    categorias: new Set(ORDEN_CATEGORIAS),
    region: "",
    jerarquiaMin: 0,
    actividad: -1,
    libre: false,
    zona: false,
  };
}

/** Cantidad de filtros activos sin contar búsqueda ni categorías */
export function filtrosActivos(f: Filtros): number {
  return (
    (f.region ? 1 : 0) +
    (f.jerarquiaMin > 0 ? 1 : 0) +
    (f.actividad >= 0 ? 1 : 0) +
    (f.libre ? 1 : 0) +
    (f.zona ? 1 : 0)
  );
}

export interface Resultado {
  /** recursos que pasan todos los filtros, en el orden del índice */
  lista: Recurso[];
  /** ids que se dibujan en el mapa (todos los filtros salvo zona visible) */
  enMapa: Set<number>;
  /** conteo por categoría con los demás filtros aplicados */
  porCategoria: Record<number, number>;
}

export function aplicar(recursos: Recurso[], f: Filtros, limites: Limites | null): Resultado {
  const terminos = normalizar(f.q).split(/\s+/).filter(Boolean);
  const lista: Recurso[] = [];
  const enMapa = new Set<number>();
  const porCategoria: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const r of recursos) {
    if (f.region && r.region !== f.region) continue;
    if (r.jerarquia < f.jerarquiaMin) continue;
    if (f.actividad >= 0 && !r.actividades.includes(f.actividad)) continue;
    if (f.libre && r.ingreso !== 1) continue;
    if (terminos.length && !terminos.every((t) => r.busqueda.includes(t))) continue;
    porCategoria[r.categoria]++;
    if (!f.categorias.has(r.categoria)) continue;
    if (r.lat !== null) enMapa.add(r.id);
    if (f.zona) {
      if (r.lat === null || r.lng === null || !limites) continue;
      if (r.lat < limites.sur || r.lat > limites.norte || r.lng < limites.oeste || r.lng > limites.este)
        continue;
    }
    lista.push(r);
  }
  return { lista, enMapa, porCategoria };
}

// --- URL ---

export function leerUrl(actividades: string[]): { filtros: Filtros; seleccion: number | null } {
  const p = new URLSearchParams(location.search);
  const f = filtrosVacios();
  f.q = p.get("q") ?? "";
  const cat = p.get("cat");
  if (cat !== null) {
    f.categorias = new Set(
      cat.split(",").map(Number).filter((n) => ORDEN_CATEGORIAS.includes(n))
    );
  }
  f.region = p.get("region") ?? "";
  f.jerarquiaMin = Math.min(4, Math.max(0, Number(p.get("jer")) || 0));
  const act = p.get("act");
  f.actividad = act ? actividades.indexOf(act) : -1;
  f.libre = p.get("libre") === "1";
  f.zona = p.get("zona") === "1";
  const r = Number(p.get("r"));
  return { filtros: f, seleccion: Number.isInteger(r) && r > 0 ? r : null };
}

export function escribirUrl(
  f: Filtros,
  seleccion: number | null,
  actividades: string[],
  modo: "push" | "replace"
) {
  const p = new URLSearchParams();
  if (seleccion !== null) p.set("r", String(seleccion));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.categorias.size !== ORDEN_CATEGORIAS.length)
    p.set("cat", ORDEN_CATEGORIAS.filter((c) => f.categorias.has(c)).join(","));
  if (f.region) p.set("region", f.region);
  if (f.jerarquiaMin > 0) p.set("jer", String(f.jerarquiaMin));
  if (f.actividad >= 0) p.set("act", actividades[f.actividad]);
  if (f.libre) p.set("libre", "1");
  if (f.zona) p.set("zona", "1");
  const qs = p.toString();
  const url = location.pathname + (qs ? `?${qs}` : "") + location.hash;
  if (url === location.pathname + location.search + location.hash) return;
  if (modo === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}
