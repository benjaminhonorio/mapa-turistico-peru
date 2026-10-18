// Itinerarios guardados en el navegador (localStorage), enlaces para compartirlos y cálculos de distancia

import type { Recurso } from "./data";

export interface Parada {
  id: number;
  visitada: boolean;
}

export interface Itinerario {
  id: string;
  nombre: string;
  paradas: Parada[];
  creado: number;
  actualizado: number;
}

interface Almacen {
  version: 1;
  activo: string | null;
  itinerarios: Itinerario[];
}

const CLAVE = "mapa-turistico-peru:itinerarios";

function vacio(): Almacen {
  return { version: 1, activo: null, itinerarios: [] };
}

function leer(): Almacen {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return vacio();
    const a = JSON.parse(crudo) as Almacen;
    if (a?.version !== 1 || !Array.isArray(a.itinerarios)) return vacio();
    if (!a.itinerarios.some((i) => i.id === a.activo)) a.activo = a.itinerarios[0]?.id ?? null;
    return a;
  } catch {
    return vacio();
  }
}

function nuevoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export type Almacenamiento = ReturnType<typeof crearAlmacen>;

export function crearAlmacen() {
  let estado = leer();
  const oyentes = new Set<() => void>();

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch (e) {
      console.warn("No se pudo guardar el itinerario", e);
    }
    avisar();
  }

  function avisar() {
    for (const f of oyentes) f();
  }

  // otra pestaña cambió los itinerarios
  addEventListener("storage", (e) => {
    if (e.key !== CLAVE) return;
    estado = leer();
    avisar();
  });

  function activo(): Itinerario | null {
    return estado.itinerarios.find((i) => i.id === estado.activo) ?? null;
  }

  /** modifica el itinerario activo y guarda */
  function cambiar(f: (i: Itinerario) => void) {
    const i = activo();
    if (!i) return;
    f(i);
    i.actualizado = Date.now();
    guardar();
  }

  function crear(nombre: string, paradas: Parada[] = []): Itinerario {
    const ahora = Date.now();
    const i: Itinerario = { id: nuevoId(), nombre: nombre.trim() || "Mi ruta", paradas, creado: ahora, actualizado: ahora };
    estado.itinerarios.push(i);
    estado.activo = i.id;
    guardar();
    return i;
  }

  return {
    alCambiar(f: () => void) {
      oyentes.add(f);
    },
    lista: () => estado.itinerarios,
    activo,
    crear,
    elegir(id: string) {
      if (!estado.itinerarios.some((i) => i.id === id)) return;
      estado.activo = id;
      guardar();
    },
    eliminar(id: string) {
      estado.itinerarios = estado.itinerarios.filter((i) => i.id !== id);
      if (estado.activo === id) estado.activo = estado.itinerarios.at(-1)?.id ?? null;
      guardar();
    },
    renombrar(nombre: string) {
      cambiar((i) => (i.nombre = nombre.trim() || "Mi ruta"));
    },
    contiene(idRecurso: number): boolean {
      return activo()?.paradas.some((p) => p.id === idRecurso) ?? false;
    },
    /** agrega o quita del itinerario activo (crea uno si no hay) */
    alternar(idRecurso: number) {
      if (!activo()) crear("Mi ruta");
      cambiar((i) => {
        const k = i.paradas.findIndex((p) => p.id === idRecurso);
        if (k >= 0) i.paradas.splice(k, 1);
        else i.paradas.push({ id: idRecurso, visitada: false });
      });
    },
    /** lleva la parada al lugar que ocupa `idDestino` */
    mover(idRecurso: number, idDestino: number) {
      cambiar((i) => {
        const k = i.paradas.findIndex((p) => p.id === idRecurso);
        const destino = i.paradas.findIndex((p) => p.id === idDestino);
        if (k < 0 || destino < 0 || k === destino) return;
        const [p] = i.paradas.splice(k, 1);
        i.paradas.splice(destino, 0, p);
      });
    },
    marcarVisitada(idRecurso: number, visitada: boolean) {
      cambiar((i) => {
        const p = i.paradas.find((p) => p.id === idRecurso);
        if (p) p.visitada = visitada;
      });
    },
    reiniciarVisitas() {
      cambiar((i) => i.paradas.forEach((p) => (p.visitada = false)));
    },
  };
}

// --- Compartir ---

/** ?ruta=132,757,1598&nombre=... */
export function enlaceCompartir(i: Itinerario): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("ruta", i.paradas.map((p) => p.id).join(","));
  url.searchParams.set("nombre", i.nombre);
  return url.toString();
}

export function leerRutaCompartida(existe: (id: number) => boolean): { nombre: string; ids: number[] } | null {
  const p = new URLSearchParams(location.search);
  const ruta = p.get("ruta");
  if (!ruta) return null;
  const ids = [...new Set(ruta.split(",").map(Number))].filter((n) => Number.isInteger(n) && existe(n));
  if (!ids.length) return null;
  return { nombre: p.get("nombre")?.slice(0, 80) || "Ruta compartida", ids };
}

/** Lee un archivo exportado (uno o varios itinerarios) */
export function leerExportado(texto: string, existe: (id: number) => boolean): { nombre: string; paradas: Parada[] }[] {
  const datos = JSON.parse(texto) as unknown;
  const lista = Array.isArray(datos) ? datos : [datos];
  return lista
    .filter((i): i is Itinerario => !!i && typeof i === "object" && Array.isArray((i as Itinerario).paradas))
    .map((i) => ({
      nombre: String(i.nombre ?? "Ruta importada").slice(0, 80),
      paradas: i.paradas
        .filter((p) => Number.isInteger(p?.id) && existe(p.id))
        .map((p) => ({ id: p.id, visitada: !!p.visitada })),
    }))
    .filter((i) => i.paradas.length);
}

// --- Distancias y navegación ---

export type Coordenada = { lat: number; lng: number };

export function conPunto(r: Recurso): r is Recurso & Coordenada {
  return r.lat !== null && r.lng !== null;
}

/** distancia en km por la superficie (haversine) */
export function distancia(a: Coordenada, b: Coordenada): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

const fmtKm = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
const fmtKmEntero = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });

export function km(d: number): string {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  return `${(d < 100 ? fmtKm : fmtKmEntero).format(d)} km`;
}

/** Google Maps acepta hasta 9 puntos intermedios */
export const MAX_INTERMEDIOS = 9;

/** Indicaciones de Google Maps desde la ubicación actual hasta las paradas dadas, en orden */
export function enlaceIndicaciones(paradas: Coordenada[]): string | null {
  const puntos = paradas.slice(0, MAX_INTERMEDIOS + 1).map((p) => `${p.lat},${p.lng}`);
  if (!puntos.length) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", puntos.at(-1)!);
  if (puntos.length > 1) url.searchParams.set("waypoints", puntos.slice(0, -1).join("|"));
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}
