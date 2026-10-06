// Carga y decodifica public/data/index.json (generado por scripts/build_data.py)

export const BASE = import.meta.env.BASE_URL.replace(/\/?$/, "/");

export interface Recurso {
  id: number;
  nombre: string;
  categoria: number;
  tipo: string;
  subtipo: string;
  region: string;
  provincia: string;
  distrito: string;
  jerarquia: number;
  lat: number | null;
  lng: number | null;
  altitud: number | null;
  actividades: number[];
  ingreso: number;
  fotos: number;
  /** visitantes del último año registrado (0 si no hay dato) */
  visitantes: number;
  /** texto normalizado para búsqueda */
  busqueda: string;
}

export interface Indice {
  fechaCorte: string | null;
  regiones: string[];
  actividades: string[];
  /** ordenados por jerarquía (desc) y luego nombre */
  recursos: Recurso[];
  porId: Map<number, Recurso>;
}

interface IndiceCrudo {
  fechaCorte: string | null;
  dic: Record<"tipos" | "subtipos" | "regiones" | "provincias" | "distritos" | "actividades", string[]>;
  recursos: [
    number, string, number, number, number, number, number, number,
    number, number | null, number | null, number | null, number[], number, number, number,
  ][];
}

/** minúsculas y sin tildes */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export const CATEGORIAS: Record<number, { nombre: string; corto: string; color: string }> = {
  1: { nombre: "Sitios naturales", corto: "Naturales", color: "#2b8a57" },
  2: { nombre: "Manifestaciones culturales", corto: "Culturales", color: "#2a5cb5" },
  3: { nombre: "Folclore", corto: "Folclore", color: "#c9971c" },
  4: {
    nombre: "Realizaciones técnicas, científicas y artísticas contemporáneas",
    corto: "Realizaciones técnicas",
    color: "#8e3aa0",
  },
  5: { nombre: "Acontecimientos programados", corto: "Acontecimientos", color: "#be2440" },
};

/** Orden de los chips: igual que la numeración de MINCETUR */
export const ORDEN_CATEGORIAS = [1, 2, 3, 4, 5];

// Paráfrasis aproximada de las definiciones de MINCETUR, no texto oficial
export const JERARQUIAS: Record<number, string> = {
  4: "internacional",
  3: "nacional",
  2: "regional",
  1: "local",
};

export const INGRESOS: Record<number, string> = {
  1: "Ingreso libre",
  2: "Con boleto",
  3: "Con permiso previo",
  4: "Otro tipo de ingreso",
};

export async function cargarIndice(): Promise<Indice> {
  const res = await fetch(`${BASE}data/index.json`);
  if (!res.ok) throw new Error(`No se pudo cargar el índice (${res.status})`);
  const crudo = (await res.json()) as IndiceCrudo;
  const d = crudo.dic;
  const recursos: Recurso[] = crudo.recursos.map((f) => {
    const r: Recurso = {
      id: f[0],
      nombre: f[1],
      categoria: f[2],
      tipo: d.tipos[f[3]] ?? "",
      subtipo: d.subtipos[f[4]] ?? "",
      region: d.regiones[f[5]] ?? "",
      provincia: d.provincias[f[6]] ?? "",
      distrito: d.distritos[f[7]] ?? "",
      jerarquia: f[8],
      lat: f[9],
      lng: f[10],
      altitud: f[11],
      actividades: f[12],
      ingreso: f[13],
      fotos: f[14],
      visitantes: f[15] ?? 0,
      busqueda: "",
    };
    r.busqueda = normalizar([r.nombre, r.subtipo, r.distrito, r.provincia].join(" "));
    return r;
  });
  const colador = new Intl.Collator("es", { sensitivity: "base" });
  recursos.sort((a, b) => b.jerarquia - a.jerarquia || colador.compare(a.nombre, b.nombre));
  return {
    fechaCorte: crudo.fechaCorte,
    regiones: [...d.regiones].sort(colador.compare),
    actividades: d.actividades,
    recursos,
    porId: new Map(recursos.map((r) => [r.id, r])),
  };
}

export interface Detalle {
  id: number;
  nombre: string;
  categoria: number;
  tipo?: string;
  subtipo?: string;
  region?: string;
  provincia?: string;
  distrito?: string;
  jerarquia: number;
  jerarquiaTexto?: string;
  altitud?: number;
  lat?: number;
  lng?: number;
  fotos?: number;
  url?: string;
  descripcion?: string;
  estado?: string;
  particularidades?: string;
  reconocimientos?: string;
  observaciones?: string;
  ingreso?: { tipo?: string; detalle?: string }[];
  epoca?: { epoca?: string; detalle?: string; horario?: string; observacion?: string }[];
  rutas?: {
    recorrido?: string;
    tramo?: string;
    detalle?: string;
    acceso?: string;
    medio?: string;
    via?: string;
    distancia?: string;
  }[];
  actividades?: { nombre?: string; grupo?: string; detalle?: string }[];
  visitantes?: { tipo?: string; cantidad?: string; fuente?: string; anio?: string; detalle?: string }[];
  accesibilidad?: {
    visitante?: string;
    instalacion?: string;
    programas?: string;
    equipamiento?: string;
    detalle?: string;
  }[];
  servicios?: {
    titulo: string;
    items: { nombre?: string; grupo?: string; instalacion?: string; detalle?: string }[];
  }[];
}

const cacheDetalle = new Map<number, Promise<Detalle>>();

export function cargarDetalle(id: number): Promise<Detalle> {
  let p = cacheDetalle.get(id);
  if (!p) {
    p = fetch(`${BASE}data/r/${id}.json`).then((res) => {
      if (!res.ok) throw new Error(`No se pudo cargar la ficha ${id} (${res.status})`);
      return res.json() as Promise<Detalle>;
    });
    p.catch(() => cacheDetalle.delete(id));
    cacheDetalle.set(id, p);
  }
  return p;
}
