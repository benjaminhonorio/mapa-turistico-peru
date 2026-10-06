import { cargarDetalle, cargarIndice, CATEGORIAS, ORDEN_CATEGORIAS, type Indice, type Recurso } from "./data";
import { cabecera, cuerpo } from "./detalle";
import { h } from "./dom";
import { aplicar, escribirUrl, filtrosActivos, filtrosVacios, leerUrl, type Filtros } from "./filtros";
import { crearLista } from "./lista";
import { crearMapa, PERU, type MapaTuristico } from "./mapa";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = document.querySelector<HTMLElement>(".app")!;
const panel = $("panel");
const buscar = $<HTMLInputElement>("buscar");
const chips = $("chips");
const fRegion = $<HTMLSelectElement>("f-region");
const fActividad = $<HTMLSelectElement>("f-actividad");
const fJerarquia = $("f-jerarquia");
const fLibre = $<HTMLInputElement>("f-libre");
const fZona = $<HTMLInputElement>("f-zona");
const masFiltros = $<HTMLDetailsElement>("mas-filtros");
const contadorFiltros = $("contador-filtros");
const conteo = $("conteo");
const limpiar = $("limpiar");
const vistaLista = $("vista-lista");
const vistaDetalle = $("vista-detalle");
const asa = $("hoja-asa");

const movil = matchMedia("(max-width: 760px)");
const fmt = new Intl.NumberFormat("es-PE");

let indice: Indice;
let mapa: MapaTuristico;
let filtros: Filtros = filtrosVacios();
let seleccion: Recurso | null = null;
/** el detalle se abrió con pushState y "volver" puede usar history.back() */
let detalleEnHistorial = false;
let temporizadorUrl = 0;

// --- Hoja inferior en móvil ---

type EstadoHoja = "mini" | "media" | "llena";

function hoja(estado: EstadoHoja) {
  app.dataset.hoja = estado;
  asa.setAttribute("aria-label", estado === "llena" ? "Reducir panel" : "Expandir panel");
  asa.setAttribute("aria-expanded", String(estado !== "mini"));
  ajustarPaddingMapa();
}

function ajustarPaddingMapa() {
  if (!mapa) return;
  if (!movil.matches) return mapa.ajustarPadding({});
  const alto = panel.getBoundingClientRect().height;
  mapa.ajustarPadding({ bottom: Math.min(alto, innerHeight * 0.6) });
}

asa.addEventListener("click", () => {
  const actual = app.dataset.hoja as EstadoHoja;
  hoja(actual === "mini" ? "media" : actual === "media" ? "llena" : "mini");
});

// arrastre simple del asa
{
  let y0: number | null = null;
  asa.addEventListener("pointerdown", (e) => {
    y0 = e.clientY;
  });
  addEventListener("pointerup", (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0;
    y0 = null;
    if (Math.abs(dy) < 30) return;
    const actual = app.dataset.hoja as EstadoHoja;
    const orden: EstadoHoja[] = ["mini", "media", "llena"];
    const i = orden.indexOf(actual) + (dy < 0 ? 1 : -1);
    hoja(orden[Math.max(0, Math.min(2, i))]);
    asa.dataset.arrastre = "1";
  });
  asa.addEventListener(
    "click",
    (e) => {
      if (asa.dataset.arrastre) {
        delete asa.dataset.arrastre;
        e.stopImmediatePropagation();
      }
    },
    { capture: true }
  );
}

// --- Filtros ---

function crearChips() {
  for (const c of ORDEN_CATEGORIAS) {
    const cat = CATEGORIAS[c];
    chips.append(
      h(
        "button",
        {
          type: "button",
          class: "chip",
          style: `--cat:${cat.color}`,
          "data-cat": c,
          "aria-pressed": "true",
          title: cat.nombre,
          onclick: () => {
            if (filtros.categorias.has(c)) filtros.categorias.delete(c);
            else filtros.categorias.add(c);
            actualizar();
          },
        },
        h("span", { class: "chip-punto", "aria-hidden": "true" }),
        h("span", { class: "chip-nombre" }, cat.corto),
        h("span", { class: "chip-num" })
      )
    );
  }
}

function llenarSelects() {
  for (const r of indice.regiones) fRegion.append(h("option", { value: r }, r));
  const colador = new Intl.Collator("es");
  indice.actividades
    .map((a, i) => ({ a, i }))
    .sort((x, y) => colador.compare(x.a, y.a))
    .forEach(({ a, i }) => fActividad.append(h("option", { value: i }, a.replace(/\s*\(Especificar\)/i, ""))));
}

/** Refleja el estado en los controles */
function pintarControles() {
  buscar.value = filtros.q;
  fRegion.value = filtros.region;
  fActividad.value = String(filtros.actividad);
  fLibre.checked = filtros.libre;
  fZona.checked = filtros.zona;
  fJerarquia.querySelectorAll<HTMLInputElement>("input").forEach((i) => {
    i.checked = Number(i.value) === filtros.jerarquiaMin;
  });
}

function leerControles() {
  filtros.q = buscar.value;
  filtros.region = fRegion.value;
  filtros.actividad = Number(fActividad.value);
  filtros.libre = fLibre.checked;
  filtros.zona = fZona.checked;
  const jer = fJerarquia.querySelector<HTMLInputElement>("input:checked");
  filtros.jerarquiaMin = jer ? Number(jer.value) : 0;
}

let lista: ReturnType<typeof crearLista>;
let ultimoMapa = "";

function actualizar({ volverArriba = true, url = true } = {}) {
  const res = aplicar(indice.recursos, filtros, filtros.zona ? mapa.limites() : null);

  // mapa: solo si cambió algún filtro que lo afecta (la zona visible solo afecta la lista)
  const firma = filtrosClaveMapa();
  if (firma !== ultimoMapa) {
    ultimoMapa = firma;
    mapa.mostrar(res.enMapa);
  }

  lista.actualizar(res.lista, volverArriba);

  for (const b of chips.querySelectorAll<HTMLButtonElement>(".chip")) {
    const c = Number(b.dataset.cat);
    const activo = filtros.categorias.has(c);
    b.setAttribute("aria-pressed", String(activo));
    b.querySelector(".chip-num")!.textContent = fmt.format(res.porCategoria[c]);
  }

  const sinPunto = res.lista.reduce((n, r) => n + (r.lat === null ? 1 : 0), 0);
  const total = res.lista.length;
  conteo.textContent =
    total === 0
      ? "Ningún recurso coincide"
      : `${fmt.format(total)} ${total === 1 ? "recurso" : "recursos"}` +
        (sinPunto ? ` · ${fmt.format(sinPunto)} sin punto` : "");

  const activos = filtrosActivos(filtros) - (filtros.zona ? 1 : 0);
  contadorFiltros.hidden = activos === 0;
  contadorFiltros.textContent = String(activos);
  limpiar.hidden =
    !filtros.q.trim() && activos === 0 && filtros.categorias.size === ORDEN_CATEGORIAS.length;

  if (url) {
    clearTimeout(temporizadorUrl);
    temporizadorUrl = window.setTimeout(
      () => escribirUrl(filtros, seleccion?.id ?? null, indice.actividades, "replace"),
      250
    );
  }
}

function filtrosClaveMapa() {
  const f = filtros;
  return [f.q, [...f.categorias].join(), f.region, f.jerarquiaMin, f.actividad, f.libre].join("|");
}

// --- Detalle ---

async function abrir(r: Recurso, { acercar = true, historial = true } = {}) {
  seleccion = r;
  mapa.seleccionar(r, acercar);
  if (historial) {
    clearTimeout(temporizadorUrl);
    escribirUrl(filtros, r.id, indice.actividades, detalleEnHistorial ? "replace" : "push");
    detalleEnHistorial = true;
  }

  vistaDetalle.replaceChildren(cabecera(r, cerrar), h("p", { class: "cargando" }, "Cargando ficha…"));
  vistaLista.hidden = true;
  vistaDetalle.hidden = false;
  vistaDetalle.scrollTop = 0;
  panel.scrollTop = 0;
  if (movil.matches && app.dataset.hoja === "mini") hoja("media");
  vistaDetalle.querySelector<HTMLElement>("#detalle-titulo")?.focus({ preventScroll: true });

  try {
    const d = await cargarDetalle(r.id);
    if (seleccion?.id !== r.id) return;
    vistaDetalle.querySelector(".cargando")?.remove();
    vistaDetalle.append(cuerpo(r, d));
  } catch (e) {
    if (seleccion?.id !== r.id) return;
    const aviso = vistaDetalle.querySelector(".cargando");
    if (aviso) aviso.textContent = "No se pudo cargar la ficha. Revisa tu conexión e inténtalo de nuevo.";
    console.warn(e);
  }
}

function cerrar() {
  if (detalleEnHistorial && history.length > 1) {
    history.back(); // popstate se encarga de cerrar
    return;
  }
  cerrarVista();
  escribirUrl(filtros, null, indice.actividades, "replace");
}

function cerrarVista() {
  const anterior = seleccion;
  seleccion = null;
  detalleEnHistorial = false;
  mapa.seleccionar(null, false);
  vistaDetalle.hidden = true;
  vistaDetalle.replaceChildren();
  vistaLista.hidden = false;
  if (anterior) {
    // devolver el foco a la fila si está pintada
    $("lista").querySelector<HTMLElement>(`[data-id="${anterior.id}"]`)?.focus({ preventScroll: true });
  }
}

addEventListener("popstate", () => {
  const estado = leerUrl(indice.actividades);
  filtros = estado.filtros;
  pintarControles();
  actualizar({ volverArriba: false, url: false });
  const r = estado.seleccion !== null ? indice.porId.get(estado.seleccion) : undefined;
  if (r) {
    detalleEnHistorial = false;
    abrir(r, { historial: false });
  } else if (seleccion) cerrarVista();
});

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && seleccion && !vistaDetalle.hidden) {
    const activo = document.activeElement;
    if (activo instanceof HTMLInputElement || activo instanceof HTMLSelectElement) return;
    cerrar();
  }
});

// --- Inicio ---

function fechaLegible(f: string | null): string {
  if (!f || !/^\d{8}$/.test(f)) return f ?? "—";
  const d = new Date(Date.UTC(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8)));
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

async function iniciar() {
  try {
    indice = await cargarIndice();
  } catch (e) {
    conteo.textContent = "No se pudieron cargar los datos.";
    console.error(e);
    return;
  }

  const corte = fechaLegible(indice.fechaCorte);
  $("fecha-corte").textContent = corte;
  crearChips();
  llenarSelects();

  const estado = leerUrl(indice.actividades);
  filtros = estado.filtros;
  pintarControles();
  if (filtrosActivos(filtros) - (filtros.zona ? 1 : 0) > 0) masFiltros.open = true;

  mapa = crearMapa({
    contenedor: $("mapa"),
    recursos: indice.recursos,
    atribucion: `Datos: <a href="https://www.datosabiertos.gob.pe/dataset/inventario-nacional-de-recursos-tur%C3%ADsticos" target="_blank" rel="noopener">Inventario Nacional de Recursos Turísticos, MINCETUR</a> (ODC-BY), corte ${corte}`,
    alSeleccionar: (id) => {
      const r = indice.porId.get(id);
      if (r) abrir(r, { acercar: true });
    },
    alMover: () => {
      if (filtros.zona) actualizar({ url: false });
    },
  });

  if (import.meta.env.DEV) Object.assign(window, { __mapa: mapa.mapa });
  lista = crearLista($("lista"), $("lista-alto"), (r) => abrir(r));
  actualizar({ url: false });

  const inicial = estado.seleccion !== null ? indice.porId.get(estado.seleccion) : undefined;
  if (inicial) hoja("media");
  ajustarPaddingMapa();
  // reencuadrar con el layout ya asentado; en móvil la hoja tapa la parte baja
  if (!inicial) mapa.mapa.fitBounds(PERU, { padding: movil.matches ? 16 : 48, duration: 0 });
  if (inicial) {
    await mapa.listo;
    abrir(inicial, { historial: false });
  }
}

// eventos de controles
buscar.addEventListener("input", () => {
  leerControles();
  actualizar();
});
for (const el of [fRegion, fActividad, fLibre, fZona]) {
  el.addEventListener("change", () => {
    leerControles();
    actualizar();
  });
}
fJerarquia.addEventListener("change", () => {
  leerControles();
  actualizar();
});
limpiar.addEventListener("click", () => {
  const zona = filtros.zona;
  filtros = filtrosVacios();
  filtros.zona = zona;
  pintarControles();
  actualizar();
  buscar.focus();
});
buscar.addEventListener("focus", () => {
  if (movil.matches && app.dataset.hoja === "mini") hoja("media");
});
movil.addEventListener("change", ajustarPaddingMapa);
new ResizeObserver(() => ajustarPaddingMapa()).observe(panel);

iniciar();
