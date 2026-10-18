// "Mis lugares": sitios que el usuario agrega porque no están en el inventario. Se guardan en el navegador
// con id negativo para convivir con los recursos en las paradas, el mapa y la URL.

import { CATEGORIA_PROPIA, normalizar, type Indice, type Recurso } from "./data";
import type { Coordenada } from "./itinerario";

export interface Lugar extends Coordenada {
  id: number;
  nombre: string;
  nota: string;
  creado: number;
}

/** lo que viaja en un enlace o archivo: sin id local */
export type LugarNuevo = Pick<Lugar, "nombre" | "lat" | "lng"> & { nota?: string };

interface Catalogo {
  version: 1;
  /** el próximo id es -siguiente; no se reutilizan */
  siguiente: number;
  lugares: Lugar[];
}

const CLAVE = "mapa-turistico-peru:lugares";

export const esPropio = (id: number) => id < 0;

function vacio(): Catalogo {
  return { version: 1, siguiente: 1, lugares: [] };
}

function leer(): Catalogo {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return vacio();
    const c = JSON.parse(crudo) as Catalogo;
    if (c?.version !== 1 || !Array.isArray(c.lugares)) return vacio();
    return c;
  } catch {
    return vacio();
  }
}

/** valida y recorta lo que llega de fuera (enlace, archivo) */
export function lugarValido(l: unknown): LugarNuevo | null {
  const x = l as Partial<LugarNuevo> | null;
  if (!x || typeof x !== "object") return null;
  const lat = Number(x.lat);
  const lng = Number(x.lng);
  const nombre = String(x.nombre ?? "").trim().slice(0, 80);
  if (!nombre || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { nombre, lat: redondear(lat), lng: redondear(lng), nota: String(x.nota ?? "").slice(0, 500) };
}

/** ~1 m de precisión */
function redondear(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function aRecurso(l: Lugar): Recurso {
  return {
    id: l.id,
    nombre: l.nombre,
    categoria: CATEGORIA_PROPIA,
    tipo: "Lugar agregado por ti",
    subtipo: "",
    region: "",
    provincia: "",
    distrito: "",
    jerarquia: 0,
    lat: l.lat,
    lng: l.lng,
    altitud: null,
    actividades: [],
    ingreso: 0,
    fotos: 0,
    visitantes: 0,
    busqueda: normalizar(l.nombre),
  };
}

export type Lugares = ReturnType<typeof crearLugares>;

/** El catálogo se refleja en `indice.porId` para que las paradas propias se resuelvan como cualquier recurso */
export function crearLugares(indice: Indice) {
  let estado = leer();
  const oyentes = new Set<() => void>();

  function reflejar() {
    for (const id of [...indice.porId.keys()]) if (esPropio(id)) indice.porId.delete(id);
    for (const l of estado.lugares) indice.porId.set(l.id, aRecurso(l));
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch (e) {
      console.warn("No se pudo guardar el lugar", e);
    }
    avisar();
  }

  function avisar() {
    reflejar();
    for (const f of oyentes) f();
  }

  addEventListener("storage", (e) => {
    if (e.key !== CLAVE) return;
    estado = leer();
    avisar();
  });

  reflejar();

  function crear(l: LugarNuevo): Lugar {
    const nuevo: Lugar = {
      id: -estado.siguiente++,
      nombre: l.nombre.trim().slice(0, 80) || "Mi lugar",
      nota: (l.nota ?? "").trim().slice(0, 500),
      lat: redondear(l.lat),
      lng: redondear(l.lng),
      creado: Date.now(),
    };
    estado.lugares.push(nuevo);
    guardar();
    return nuevo;
  }

  return {
    alCambiar(f: () => void) {
      oyentes.add(f);
    },
    /** más recientes primero */
    lista: () => [...estado.lugares].sort((a, b) => b.creado - a.creado),
    obtener: (id: number) => estado.lugares.find((l) => l.id === id),
    crear,
    editar(id: number, cambios: LugarNuevo) {
      const l = estado.lugares.find((x) => x.id === id);
      if (!l) return;
      l.nombre = cambios.nombre.trim().slice(0, 80) || l.nombre;
      l.nota = (cambios.nota ?? "").trim().slice(0, 500);
      l.lat = redondear(cambios.lat);
      l.lng = redondear(cambios.lng);
      guardar();
    },
    eliminar(id: number) {
      estado.lugares = estado.lugares.filter((l) => l.id !== id);
      guardar();
    },
    /** id de un lugar igual ya guardado, o uno nuevo (al recibir una ruta compartida o importada) */
    resolver(l: LugarNuevo): number {
      const n = normalizar(l.nombre.trim());
      const igual = estado.lugares.find(
        (x) => normalizar(x.nombre) === n && x.lat === redondear(l.lat) && x.lng === redondear(l.lng)
      );
      return igual ? igual.id : crear(l).id;
    },
  };
}
