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
import { CATEGORIAS, type Recurso } from "./data";
import type { Limites } from "./filtros";

const ESTILO = "https://tiles.openfreemap.org/styles/positron";
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const PERU: LngLatBoundsLike = [
  [-81.4, -18.4],
  [-68.6, -0.0],
];

const TINTA = "#14203a";

type Punto = Feature<Point, { id: number; n: string; c: number; j: number; v: number }>;

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

    // Hover y clic
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "popup-nombre",
      maxWidth: "260px",
    });
    let hover: number | null = null;
    const capas = ["recursos-punto", "etiqueta-0", "etiqueta-2", "etiqueta-3", "etiqueta-4"];

    const quitarHover = () => {
      if (hover !== null) mapa.setFeatureState({ source: "recursos", id: hover }, { hover: false });
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
        mapa.setFeatureState({ source: "recursos", id }, { hover: true });
        const coords = (f.geometry as Point).coordinates as [number, number];
        popup.setLngLat(coords).setText(f.properties.n as string).addTo(mapa);
      });
      mapa.on("mouseleave", capa, quitarHover);
    }

    // Clic exacto sobre punto o etiqueta; si no, lo más cercano en 10 px (el dedo tapa el punto)
    mapa.on("click", (ev) => {
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
      hits.sort((a, b) => (b.properties.j as number) - (a.properties.j as number));
      o.alSeleccionar(hits[0].properties.id as number);
    });

    mapa.on("moveend", o.alMover);
    if (seleccionado) pintarSeleccion(seleccionado);
  }

  function vacio(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
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

  return { mapa, listo, mostrar, seleccionar, limites, ajustarPadding };
}
