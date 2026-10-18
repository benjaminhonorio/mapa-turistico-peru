// Mapa MapLibre: puntos por categoría y jerarquía, etiquetas progresivas, relieve

import * as maplibregl from "maplibre-gl";
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre arma la URL de su worker en tiempo de ejecución y Vite no la detecta: se la damos explícita
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { CATEGORIA_PROPIA, CATEGORIAS, type Recurso } from "./data";
import type { Limites } from "./filtros";
import type { Coordenada } from "./itinerario";

const ESTILO = "https://tiles.openfreemap.org/styles/positron";
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const PERU: LngLatBoundsLike = [
  [-81.4, -18.4],
  [-68.6, -0.0],
];

const TINTA = "#14203a";
/** distinto de los colores de categoría */
const RUTA = "#e8590c";
const PROPIO = CATEGORIAS[CATEGORIA_PROPIA].color;

type Punto = Feature<Point, { id: number; n: string; c: number; j: number; v: number }>;

/** Parada del itinerario activo, ya con coordenadas */
export interface ParadaMapa extends Coordenada {
  id: number;
  nombre: string;
  numero: number;
  visitada: boolean;
  siguiente: boolean;
}

/** Un lugar de "Mis lugares" */
export interface LugarMapa extends Coordenada {
  id: number;
  nombre: string;
}

export interface OpcionesMapa {
  contenedor: HTMLElement;
  recursos: Recurso[];
  atribucion: string;
  alSeleccionar: (id: number) => void;
  alMover: () => void;
}

export interface MapaTuristico {
  mapa: maplibregl.Map;
  listo: Promise<void>;
  mostrar: (ids: Set<number>) => void;
  seleccionar: (r: Recurso | null, acercar: boolean) => void;
  limites: () => Limites;
  ajustarPadding: (padding: Partial<maplibregl.PaddingOptions>) => void;
  mostrarRuta: (paradas: ParadaMapa[]) => void;
  mostrarPosicion: (c: Coordenada | null) => void;
  encuadrar: (puntos: Coordenada[]) => void;
  mostrarLugares: (lugares: LugarMapa[]) => void;
  /** modo para ubicar un lugar: cada toque (o arrastre del pin) llama a `alElegir`; null lo apaga */
  elegirPunto: (alElegir: ((c: Coordenada) => void) | null, inicial?: Coordenada | null) => void;
}

const reducirMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const colorCategoria: ExpressionSpecification = [
  "match",
  ["get", "c"],
  1, CATEGORIAS[1].color,
  2, CATEGORIAS[2].color,
  3, CATEGORIAS[3].color,
  4, CATEGORIAS[4].color,
  5, CATEGORIAS[5].color,
  "#888",
];

/** radio según jerarquía, a un zoom dado */
function radio(base: [number, number, number, number]): ExpressionSpecification {
  return ["match", ["get", "j"], 4, base[3], 3, base[2], 2, base[1], base[0]];
}

maplibregl.setWorkerUrl(urlWorker);

export function crearMapa(o: OpcionesMapa): MapaTuristico {
  const mapa = new maplibregl.Map({
    container: o.contenedor,
    style: ESTILO,
    bounds: PERU,
    fitBoundsOptions: { padding: 24 },
    minZoom: 3,
    maxZoom: 18,
    maxPitch: 0,
    dragRotate: false,
    attributionControl: false,
    hash: false,
  });
  mapa.touchZoomRotate.disableRotation();
  mapa.keyboard.disableRotation();
  mapa.addControl(
    new maplibregl.AttributionControl({ compact: true, customAttribution: o.atribucion }),
    "bottom-right"
  );
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  mapa.addControl(
    new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }),
    "top-right"
  );
  mapa.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

  const puntos: Punto[] = o.recursos
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({
      type: "Feature",
      id: r.id,
      geometry: { type: "Point", coordinates: [r.lng!, r.lat!] },
      properties: { id: r.id, n: r.nombre, c: r.categoria, j: r.jerarquia, v: r.visitantes },
    }));

  let pendiente: Set<number> | null = null;
  let seleccionado: Recurso | null = null;
  let ruta: ParadaMapa[] = [];
  let posicion: Coordenada | null = null;
  let lugares: LugarMapa[] = [];
  let eligiendo: ((c: Coordenada) => void) | null = null;
  let pin: maplibregl.Marker | null = null;

  const listo = new Promise<void>((resolve) => {
    mapa.on("load", () => {
      // en pantallas chicas la atribución empieza plegada (sigue a un toque de distancia)
      if (o.contenedor.clientWidth < 640)
        o.contenedor.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      prepararEstilo();
      resolve();
    });
  });

  function prepararEstilo() {
    // Base más fría y desaturada, sin nombres de calles que compitan con los recursos
    const ocultar = ["highway-name-path", "highway-name-minor", "highway-shield-non-us",
      "highway-shield-us-interstate", "road_shield_us", "airport"];
    for (const id of ocultar) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, "visibility", "none");
    if (mapa.getLayer("background")) mapa.setPaintProperty("background", "background-color", "#f4f6f8");
    if (mapa.getLayer("water")) mapa.setPaintProperty("water", "fill-color", "#cfdbe6");

    mapa.addSource("dem", {
      type: "raster-dem",
      tiles: [DEM],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 12,
      attribution:
        '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Relieve: Terrain Tiles</a>',
    });
    const antesDe = mapa.getLayer("waterway") ? "waterway" : undefined;
    mapa.addLayer(
      {
        id: "relieve",
        type: "hillshade",
        source: "dem",
        paint: {
          "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 9, 0.3, 13, 0.12],
          "hillshade-shadow-color": "#3d4a63",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#5a6680",
          "hillshade-illumination-direction": 315,
        },
      },
      antesDe
    );

    mapa.addSource("recursos", {
      type: "geojson",
      data: { type: "FeatureCollection", features: pendiente ? filtrar(pendiente) : puntos },
      promoteId: "id",
    });
    mapa.addSource("seleccion", { type: "geojson", data: vacio() });
    mapa.addSource("ruta-linea", { type: "geojson", data: lineaRuta() });
    mapa.addSource("ruta-paradas", { type: "geojson", data: paradasRuta() });
    mapa.addSource("posicion", { type: "geojson", data: puntoPosicion() });
    mapa.addSource("lugares", { type: "geojson", data: puntosLugares() });

    // La línea va debajo de los puntos para no tapar recursos cercanos
    mapa.addLayer({
      id: "ruta-borde",
      type: "line",
      source: "ruta-linea",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 12, 7] },
    });
    mapa.addLayer({
      id: "ruta-trazo",
      type: "line",
      source: "ruta-linea",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": RUTA,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 12, 3.5],
        "line-dasharray": [2, 1.5],
      },
    });

    mapa.addLayer({
      id: "recursos-punto",
      type: "circle",
      source: "recursos",
      layout: { "circle-sort-key": ["get", "j"] },
      paint: {
        "circle-color": colorCategoria,
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          4, radio([2.2, 2.8, 4.2, 6.5]),
          8, radio([3.2, 4, 5.8, 8.5]),
          12, radio([5, 6, 8, 11]),
          16, radio([7, 8, 10, 13]),
        ],
        "circle-stroke-color": [
          "case", ["boolean", ["feature-state", "hover"], false], TINTA, "#ffffff",
        ],
        "circle-stroke-width": [
          "interpolate", ["linear"], ["zoom"],
          4, ["case", ["boolean", ["feature-state", "hover"], false], 2, [">=", ["get", "j"], 3], 1.4, 0.6],
          9, ["case", ["boolean", ["feature-state", "hover"], false], 2.2, [">=", ["get", "j"], 3], 1.8, 1.2],
        ],
        "circle-opacity": ["match", ["get", "j"], 0, 0.82, 1, 0.9, 1],
      },
    });

    // Mis lugares: color propio y borde grueso para distinguirlos de los recursos del inventario
    mapa.addLayer({
      id: "lugares-punto",
      type: "circle",
      source: "lugares",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 12, 8],
        "circle-color": PROPIO,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    });
    mapa.addLayer({
      id: "lugares-etiqueta",
      type: "symbol",
      source: "lugares",
      minzoom: 8,
      layout: {
        "text-field": ["get", "n"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-max-width": 9,
        "text-variable-anchor": ["left", "right", "top", "bottom"],
        "text-radial-offset": 0.9,
        "text-padding": 2,
      },
      paint: {
        "text-color": PROPIO,
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.6,
      },
    });

    mapa.addLayer({
      id: "seleccion-anillo",
      type: "circle",
      source: "seleccion",
      paint: {
        "circle-radius": 15,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": TINTA,
        "circle-stroke-width": 2.5,
      },
    });

    // Etiquetas por jerarquía: las capas de arriba se ubican primero y ganan las colisiones
    const etiquetas: { id: string; filtro: ExpressionSpecification; minzoom: number; tam: number; fuente: string }[] = [
      { id: "etiqueta-0", filtro: ["<=", ["get", "j"], 1], minzoom: 11, tam: 11.5, fuente: "Noto Sans Regular" },
      { id: "etiqueta-2", filtro: ["==", ["get", "j"], 2], minzoom: 8.5, tam: 12, fuente: "Noto Sans Regular" },
      { id: "etiqueta-3", filtro: ["==", ["get", "j"], 3], minzoom: 6, tam: 12.5, fuente: "Noto Sans Bold" },
      { id: "etiqueta-4", filtro: ["==", ["get", "j"], 4], minzoom: 0, tam: 13, fuente: "Noto Sans Bold" },
    ];
    for (const e of etiquetas) {
      mapa.addLayer({
        id: e.id,
        type: "symbol",
        source: "recursos",
        filter: e.filtro,
        minzoom: e.minzoom,
        layout: {
          "text-field": ["get", "n"],
          "text-font": [e.fuente],
          // más chicas en la vista de país para que quepan los nombres de jerarquía 4
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, e.tam - 1.5, 7, e.tam],
          "text-max-width": 9,
          "text-variable-anchor": ["left", "right", "top", "bottom"],
          "text-radial-offset": e.id === "etiqueta-4" ? 0.9 : 0.7,
          "text-justify": "auto",
          "text-padding": 2,
          // menor clave se ubica primero: dentro de una jerarquía ganan los más visitados
          "symbol-sort-key": ["-", 0, ["get", "v"]],
        },
        paint: {
          "text-color": TINTA,
          "text-halo-color": "rgba(255,255,255,0.92)",
          "text-halo-width": 1.6,
          "text-halo-blur": 0.4,
        },
      });
    }

    // Paradas numeradas y ubicación, encima de todo
    mapa.addLayer({
      id: "ruta-punto",
      type: "circle",
      source: "ruta-paradas",
      paint: {
        "circle-radius": ["case", ["get", "siguiente"], 13, 11],
        "circle-color": ["case", ["get", "visitada"], "#ffffff", RUTA],
        "circle-stroke-color": ["case", ["get", "visitada"], RUTA, ["get", "siguiente"], TINTA, "#ffffff"],
        "circle-stroke-width": ["case", ["get", "siguiente"], 3, 2],
      },
    });
    mapa.addLayer({
      id: "ruta-numero",
      type: "symbol",
      source: "ruta-paradas",
      layout: {
        "text-field": ["to-string", ["get", "numero"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ["case", ["get", "visitada"], RUTA, "#ffffff"] },
    });
    mapa.addLayer({
      id: "posicion-halo",
      type: "circle",
      source: "posicion",
      paint: { "circle-radius": 18, "circle-color": "rgba(26, 115, 232, 0.18)" },
    });
    mapa.addLayer({
      id: "posicion-punto",
      type: "circle",
      source: "posicion",
      paint: {
        "circle-radius": 7,
        "circle-color": "#1a73e8",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    });

    // Hover y clic
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "popup-nombre",
      maxWidth: "260px",
    });
    let hover: number | null = null;
    const capas = ["ruta-punto", "lugares-punto", "lugares-etiqueta", "recursos-punto", "etiqueta-0", "etiqueta-2", "etiqueta-3", "etiqueta-4"];

    const quitarHover = () => {
      if (hover !== null && hover > 0) mapa.setFeatureState({ source: "recursos", id: hover }, { hover: false });
      hover = null;
      popup.remove();
      mapa.getCanvas().style.cursor = "";
    };

    for (const capa of capas) {
      mapa.on("mousemove", capa, (ev) => {
        const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const id = f.properties.id as number;
        mapa.getCanvas().style.cursor = "pointer";
        if (id === hover) return;
        quitarHover();
        mapa.getCanvas().style.cursor = "pointer";
        hover = id;
        if (id > 0) mapa.setFeatureState({ source: "recursos", id }, { hover: true });
        const coords = (f.geometry as Point).coordinates as [number, number];
        popup.setLngLat(coords).setText(f.properties.n as string).addTo(mapa);
      });
      mapa.on("mouseleave", capa, quitarHover);
    }

    // Clic exacto sobre punto o etiqueta; si no, lo más cercano en 10 px (el dedo tapa el punto)
    mapa.on("click", (ev) => {
      if (eligiendo) {
        ponerPin({ lat: ev.lngLat.lat, lng: ev.lngLat.lng });
        eligiendo({ lat: ev.lngLat.lat, lng: ev.lngLat.lng });
        return;
      }
      let hits = mapa.queryRenderedFeatures(ev.point, { layers: capas });
      if (!hits.length) {
        const { x, y } = ev.point;
        hits = mapa.queryRenderedFeatures(
          [
            [x - 10, y - 10],
            [x + 10, y + 10],
          ],
          { layers: ["recursos-punto"] }
        );
      }
      if (!hits.length) return;
      // las paradas de la ruta van primero (j = 5), luego mis lugares (j = 4.5)
      hits.sort((a, b) => (b.properties.j as number) - (a.properties.j as number));
      o.alSeleccionar(hits[0].properties.id as number);
    });

    mapa.on("moveend", o.alMover);
    if (seleccionado) pintarSeleccion(seleccionado);
  }

  function vacio(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
  }

  function lineaRuta(): FeatureCollection {
    if (ruta.length < 2) return vacio();
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: ruta.map((p) => [p.lng, p.lat]) }, properties: {} },
      ],
    };
  }

  function paradasRuta(): FeatureCollection {
    return {
      type: "FeatureCollection",
      // la siguiente al final para que quede encima
      features: [...ruta]
        .sort((a, b) => Number(a.siguiente) - Number(b.siguiente))
        .map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { id: p.id, n: p.nombre, j: 5, numero: p.numero, visitada: p.visitada, siguiente: p.siguiente },
        })),
    };
  }

  function puntosLugares(): FeatureCollection {
    return {
      type: "FeatureCollection",
      features: lugares.map((l) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [l.lng, l.lat] },
        properties: { id: l.id, n: l.nombre, j: 4.5 },
      })),
    };
  }

  function mostrarLugares(l: LugarMapa[]) {
    lugares = l;
    mapa.getSource<GeoJSONSource>("lugares")?.setData(puntosLugares());
  }

  function ponerPin(c: Coordenada | null) {
    if (!c) {
      pin?.remove();
      pin = null;
      return;
    }
    if (pin) {
      pin.setLngLat([c.lng, c.lat]);
      return;
    }
    // la posición antes de addTo: si no, el primer cuadro lo pinta en la esquina superior izquierda
    pin = new maplibregl.Marker({ color: PROPIO, draggable: true }).setLngLat([c.lng, c.lat]);
    pin.on("dragend", () => {
      const p = pin?.getLngLat();
      if (p && eligiendo) eligiendo({ lat: p.lat, lng: p.lng });
    });
    pin.addTo(mapa);
  }

  function elegirPunto(alElegir: ((c: Coordenada) => void) | null, inicial?: Coordenada | null) {
    eligiendo = alElegir;
    o.contenedor.classList.toggle("eligiendo", !!alElegir);
    if (!alElegir) return ponerPin(null);
    if (inicial === undefined) return;
    ponerPin(inicial);
    if (inicial) {
      const zoom = Math.max(mapa.getZoom(), 14);
      if (reducirMovimiento()) mapa.jumpTo({ center: [inicial.lng, inicial.lat], zoom });
      else mapa.flyTo({ center: [inicial.lng, inicial.lat], zoom, speed: 1.6 });
    }
  }

  function puntoPosicion(): FeatureCollection {
    if (!posicion) return vacio();
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [posicion.lng, posicion.lat] }, properties: {} }],
    };
  }

  function mostrarRuta(paradas: ParadaMapa[]) {
    ruta = paradas;
    mapa.getSource<GeoJSONSource>("ruta-linea")?.setData(lineaRuta());
    mapa.getSource<GeoJSONSource>("ruta-paradas")?.setData(paradasRuta());
  }

  function mostrarPosicion(c: Coordenada | null) {
    posicion = c;
    mapa.getSource<GeoJSONSource>("posicion")?.setData(puntoPosicion());
  }

  function encuadrar(puntos: Coordenada[]) {
    if (!puntos.length) return;
    const caja = new maplibregl.LngLatBounds();
    for (const p of puntos) caja.extend([p.lng, p.lat]);
    mapa.fitBounds(caja, { padding: 56, maxZoom: 13, duration: reducirMovimiento() ? 0 : 800 });
  }

  function filtrar(ids: Set<number>): Punto[] {
    return ids.size === puntos.length ? puntos : puntos.filter((p) => ids.has(p.properties.id));
  }

  function mostrar(ids: Set<number>) {
    const fuente = mapa.getSource<GeoJSONSource>("recursos");
    if (!fuente) {
      pendiente = ids;
      return;
    }
    fuente.setData({ type: "FeatureCollection", features: filtrar(ids) });
  }

  function pintarSeleccion(r: Recurso | null) {
    const fuente = mapa.getSource<GeoJSONSource>("seleccion");
    if (!fuente) return;
    fuente.setData(
      r && r.lat !== null && r.lng !== null
        ? {
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: { type: "Point", coordinates: [r.lng, r.lat] }, properties: {} }],
          }
        : vacio()
    );
  }

  function seleccionar(r: Recurso | null, acercar: boolean) {
    seleccionado = r;
    pintarSeleccion(r);
    if (!r || r.lat === null || r.lng === null || !acercar) return;
    const zoom = Math.max(mapa.getZoom(), r.jerarquia >= 3 ? 10 : 11.5);
    if (reducirMovimiento()) mapa.jumpTo({ center: [r.lng, r.lat], zoom });
    else mapa.flyTo({ center: [r.lng, r.lat], zoom, speed: 1.6, essential: false });
  }

  function limites(): Limites {
    const b = mapa.getBounds();
    return { oeste: b.getWest(), sur: b.getSouth(), este: b.getEast(), norte: b.getNorth() };
  }

  function ajustarPadding(padding: Partial<maplibregl.PaddingOptions>) {
    const nuevo: maplibregl.PaddingOptions = { top: 0, right: 0, bottom: 0, left: 0, ...padding };
    const actual = mapa.getPadding();
    const lados = ["top", "right", "bottom", "left"] as const;
    // setPadding corta cualquier animación en curso: solo si cambió
    if (lados.every((k) => Math.round(actual[k] ?? 0) === Math.round(nuevo[k] ?? 0))) return;
    mapa.setPadding(nuevo);
  }

  return {
    mapa,
    listo,
    mostrar,
    seleccionar,
    limites,
    ajustarPadding,
    mostrarRuta,
    mostrarPosicion,
    encuadrar,
    mostrarLugares,
    elegirPunto,
  };
}
