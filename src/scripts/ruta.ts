// Vista "Mi ruta": elegir, ordenar y seguir un itinerario

import { CATEGORIAS, type Indice, type Recurso } from "./data";
import { h } from "./dom";
import {
  conPunto,
  distancia,
  enlaceCompartir,
  enlaceIndicaciones,
  km,
  leerExportado,
  MAX_INTERMEDIOS,
  type Almacenamiento,
  type Coordenada,
  type Itinerario,
} from "./itinerario";
import type { MapaTuristico, ParadaMapa } from "./mapa";

/** a menos de esto se sugiere marcar la parada como visitada */
const CERCA_KM = 0.2;

export interface OpcionesRuta {
  contenedor: HTMLElement;
  indice: Indice;
  almacen: Almacenamiento;
  mapa: MapaTuristico;
  alAbrir: (r: Recurso) => void;
}

interface Seguimiento {
  vigilancia: number;
  posicion: Coordenada | null;
  error: string | null;
  bloqueo: WakeLockSentinel | null;
}

interface Fila {
  r: Recurso;
  numero: number;
  visitada: boolean;
}

export function crearVistaRuta(o: OpcionesRuta) {
  const { contenedor, indice, almacen, mapa } = o;
  let seguimiento: Seguimiento | null = null;
  let compartida: { nombre: string; ids: number[] } | null = null;
  let mensaje = "";
  let temporizadorMensaje = 0;
  /** encuadrar ruta y posición con el primer dato de GPS */
  let encuadrarAlUbicar = false;

  const importador = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  importador.addEventListener("change", async () => {
    const archivo = importador.files?.[0];
    importador.value = "";
    if (!archivo) return;
    try {
      const rutas = leerExportado(await archivo.text(), (id) => indice.porId.has(id));
      if (!rutas.length) return avisar("El archivo no tiene rutas válidas.");
      for (const r of rutas) almacen.crear(r.nombre, r.paradas);
      avisar(rutas.length === 1 ? `Importada «${rutas[0].nombre}».` : `${rutas.length} rutas importadas.`);
    } catch {
      avisar("No se pudo leer el archivo.");
    }
  });

  function filas(i: Itinerario): Fila[] {
    return i.paradas.flatMap((p, k) => {
      const r = indice.porId.get(p.id);
      return r ? [{ r, numero: k + 1, visitada: p.visitada }] : [];
    });
  }

  function siguiente(f: Fila[]): Fila | undefined {
    return f.find((x) => !x.visitada && conPunto(x.r));
  }

  function avisar(texto: string) {
    mensaje = texto;
    clearTimeout(temporizadorMensaje);
    temporizadorMensaje = window.setTimeout(() => {
      mensaje = "";
      pintar();
    }, 3500);
    pintar();
  }

  // --- Seguimiento con GPS ---

  async function bloquearPantalla() {
    if (!seguimiento || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      seguimiento.bloqueo = await navigator.wakeLock.request("screen");
    } catch {
      // no es crítico: la pantalla puede apagarse
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (seguimiento && document.visibilityState === "visible") bloquearPantalla();
  });

  function seguir() {
    if (!("geolocation" in navigator)) return avisar("Este navegador no permite obtener tu ubicación.");
    if (!isSecureContext) return avisar("La ubicación solo funciona con HTTPS.");
    const vigilancia = navigator.geolocation.watchPosition(
      (p) => {
        if (!seguimiento) return;
        seguimiento.posicion = { lat: p.coords.latitude, lng: p.coords.longitude };
        seguimiento.error = null;
        mapa.mostrarPosicion(seguimiento.posicion);
        if (encuadrarAlUbicar) {
          encuadrarAlUbicar = false;
          const i = almacen.activo();
          const sig = i && siguiente(filas(i));
          mapa.encuadrar(sig && conPunto(sig.r) ? [seguimiento.posicion, sig.r] : [seguimiento.posicion]);
        }
        pintar();
      },
      (e) => {
        if (!seguimiento) return;
        seguimiento.error =
          e.code === e.PERMISSION_DENIED
            ? "Sin permiso para usar tu ubicación. Actívalo en los ajustes del navegador."
            : "No se pudo obtener tu ubicación. Seguimos intentando…";
        pintar();
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 }
    );
    seguimiento = { vigilancia, posicion: null, error: null, bloqueo: null };
    encuadrarAlUbicar = true;
    bloquearPantalla();
    pintar();
  }

  function dejarDeSeguir() {
    if (!seguimiento) return;
    navigator.geolocation.clearWatch(seguimiento.vigilancia);
    seguimiento.bloqueo?.release().catch(() => {});
    seguimiento = null;
    mapa.mostrarPosicion(null);
    pintar();
  }

  // --- Acciones ---

  function nueva() {
    const n = almacen.lista().length + 1;
    almacen.crear(n === 1 ? "Mi ruta" : `Ruta ${n}`);
    contenedor.querySelector<HTMLInputElement>(".ruta-nombre")?.select();
  }

  async function compartir(i: Itinerario) {
    const url = enlaceCompartir(i);
    if (navigator.share) {
      try {
        await navigator.share({ title: i.nombre, url });
      } catch {
        // cancelado
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      avisar("Enlace copiado.");
    } catch {
      prompt("Copia este enlace:", url);
    }
  }

  function exportar(i: Itinerario) {
    const blob = new Blob([JSON.stringify(i, null, 2)], { type: "application/json" });
    const a = h("a", {
      href: URL.createObjectURL(blob),
      download: `${i.nombre.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "ruta"}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function eliminar(i: Itinerario) {
    if (!confirm(`¿Eliminar la ruta «${i.nombre}»? No se puede deshacer.`)) return;
    dejarDeSeguir();
    almacen.eliminar(i.id);
  }

  // --- Arrastrar para reordenar ---

  /** mientras se arrastra no se repinta: el GPS o un aviso reemplazarían la fila en la mano */
  let arrastrando = false;
  let repintarAlSoltar = false;

  function arrastrar(e: PointerEvent, manija: HTMLElement) {
    if (arrastrando || e.button !== 0) return;
    e.preventDefault();
    const fila = manija.closest<HTMLElement>(".parada")!;
    const lista = fila.parentElement!;
    const items = [...lista.children] as HTMLElement[];
    const desde = items.indexOf(fila);
    const base = lista.getBoundingClientRect().top;
    const centros = items.map((x) => {
      const r = x.getBoundingClientRect();
      return r.top - base + r.height / 2;
    });
    const alto = fila.getBoundingClientRect().height;
    const inicioY = e.clientY;
    const inicioScroll = contenedor.scrollTop;
    let y = e.clientY;
    let hasta = desde;
    let cuadro = 0;

    arrastrando = true;
    manija.setPointerCapture(e.pointerId);
    lista.classList.add("ordenando");
    fila.classList.add("arrastrada");

    function actualizar() {
      const dy = y - inicioY + contenedor.scrollTop - inicioScroll;
      const centro = centros[desde] + dy;
      hasta = desde;
      for (let j = desde + 1; j < items.length && centro > centros[j]; j++) hasta = j;
      for (let j = desde - 1; j >= 0 && centro < centros[j]; j--) hasta = j;
      fila.style.transform = `translateY(${dy}px)`;
      items.forEach((x, j) => {
        if (x === fila) return;
        const corre = hasta > desde && j > desde && j <= hasta ? -alto : hasta < desde && j >= hasta && j < desde ? alto : 0;
        x.style.transform = corre ? `translateY(${corre}px)` : "";
      });
    }

    // desplaza la vista si se arrastra cerca del borde
    function autodesplazar() {
      const r = contenedor.getBoundingClientRect();
      const margen = 48;
      const v = y < r.top + margen ? -(r.top + margen - y) : y > r.bottom - margen ? y - (r.bottom - margen) : 0;
      if (v) {
        const antes = contenedor.scrollTop;
        contenedor.scrollTop += Math.max(-margen, Math.min(margen, v)) / 3;
        if (contenedor.scrollTop !== antes) actualizar();
      }
      cuadro = requestAnimationFrame(autodesplazar);
    }
    cuadro = requestAnimationFrame(autodesplazar);

    function mover(ev: PointerEvent) {
      y = ev.clientY;
      actualizar();
    }

    function soltar(ev: PointerEvent) {
      cancelAnimationFrame(cuadro);
      manija.removeEventListener("pointermove", mover);
      manija.removeEventListener("pointerup", soltar);
      manija.removeEventListener("pointercancel", soltar);
      lista.classList.remove("ordenando");
      fila.classList.remove("arrastrada");
      for (const x of items) x.style.transform = "";
      arrastrando = false;
      if (ev.type === "pointerup" && hasta !== desde) {
        repintarAlSoltar = false;
        almacen.mover(Number(fila.dataset.id), Number(items[hasta].dataset.id));
      } else if (repintarAlSoltar) {
        repintarAlSoltar = false;
        pintar();
      }
    }

    manija.addEventListener("pointermove", mover);
    manija.addEventListener("pointerup", soltar);
    manija.addEventListener("pointercancel", soltar);
  }

  // --- Pintado ---

  function boton(texto: string, onclick: () => void, clase = "boton boton-sec", extra: Record<string, string> = {}) {
    return h("button", { type: "button", class: clase, onclick, ...extra }, texto);
  }

  function vistaVacia(): HTMLElement[] {
    return [
      h("h2", { class: "ruta-titulo" }, "Tus rutas"),
      h(
        "p",
        { class: "ruta-ayuda" },
        "Arma un itinerario con los lugares que quieres visitar. Se guarda en este navegador y puedes seguirlo con tu ubicación."
      ),
      h("div", { class: "d-acciones" }, boton("Crear ruta", nueva, "boton"), boton("Importar archivo", () => importador.click())),
    ];
  }

  function avisoCompartida(): HTMLElement | null {
    if (!compartida) return null;
    const c = compartida;
    return h(
      "div",
      { class: "ruta-aviso", role: "status" },
      h("p", null, "Te compartieron ", h("strong", null, c.nombre), ` (${c.ids.length} ${c.ids.length === 1 ? "parada" : "paradas"}).`),
      h(
        "div",
        { class: "d-acciones" },
        boton(
          "Guardar en mis rutas",
          () => {
            compartida = null;
            almacen.crear(c.nombre, c.ids.map((id) => ({ id, visitada: false })));
            verEnMapa();
          },
          "boton"
        ),
        boton("Descartar", () => {
          compartida = null;
          pintar();
        })
      )
    );
  }

  function selector(i: Itinerario): HTMLElement {
    const sel = h(
      "select",
      { "aria-label": "Ruta activa" },
      almacen.lista().map((x) =>
        h("option", { value: x.id, selected: x.id === i.id }, `${x.nombre} (${x.paradas.length})`)
      )
    );
    sel.addEventListener("change", () => {
      dejarDeSeguir();
      almacen.elegir(sel.value);
      verEnMapa();
    });
    return h(
      "div",
      { class: "ruta-barra" },
      h("label", { class: "campo" }, h("span", null, "Ruta"), sel),
      boton("+ Nueva", nueva, "boton boton-sec ruta-nueva")
    );
  }

  function panelSeguimiento(f: Fila[]): HTMLElement | null {
    if (!seguimiento) return null;
    const s = seguimiento;
    const sig = siguiente(f);
    let cuerpo: Node[];
    if (!sig) {
      cuerpo = [h("p", { class: "seguir-titulo" }, f.length ? "¡Ruta completada!" : "La ruta no tiene paradas en el mapa.")];
    } else {
      const d = s.posicion && conPunto(sig.r) ? distancia(s.posicion, sig.r) : null;
      const cerca = d !== null && d < CERCA_KM;
      const indicaciones = conPunto(sig.r) ? enlaceIndicaciones([sig.r]) : null;
      cuerpo = [
        h("p", { class: "seguir-etiqueta" }, cerca ? "Estás llegando a" : "Siguiente parada"),
        h(
          "p",
          { class: "seguir-titulo" },
          h("span", { class: "ruta-num" }, String(sig.numero)),
          h("button", { type: "button", class: "enlace-fuerte", onclick: () => o.alAbrir(sig.r) }, sig.r.nombre)
        ),
        h(
          "p",
          { class: "seguir-dist" },
          d !== null ? `A ${km(d)} en línea recta` : s.error ?? "Buscando tu ubicación…"
        ),
        h(
          "div",
          { class: "d-acciones" },
          indicaciones
            ? h("a", { class: "boton", href: indicaciones, target: "_blank", rel: "noopener" }, "Cómo llegar")
            : null,
          boton("Marcar visitada", () => almacen.marcarVisitada(sig.r.id, true), cerca ? "boton" : "boton boton-sec")
        ),
      ];
    }
    cuerpo.push(boton("Dejar de seguir", dejarDeSeguir, "enlace seguir-salir"));
    return h("div", { class: "seguir", role: "status", "aria-live": "polite" }, ...cuerpo);
  }

  function filaParada(x: Fila, f: Fila[], k: number): HTMLElement {
    const r = x.r;
    const anterior = f[k - 1];
    const cat = CATEGORIAS[r.categoria];
    const tramo = anterior && conPunto(anterior.r) && conPunto(r) ? distancia(anterior.r, r) : null;
    const meta = [r.region, tramo !== null ? `+${km(tramo)}` : null, conPunto(r) ? null : "sin punto en el mapa"]
      .filter(Boolean)
      .join(" · ");
    const visitada = h("input", {
      type: "checkbox",
      checked: x.visitada,
      "aria-label": `Visitada: ${r.nombre}`,
      "data-foco": `v${r.id}`,
    });
    visitada.addEventListener("change", () => almacen.marcarVisitada(r.id, visitada.checked));
    const manija = h(
      "button",
      {
        type: "button",
        class: "parada-manija",
        "aria-label": `Reordenar ${r.nombre} (arrastra o usa las flechas)`,
        title: "Arrastra para reordenar",
        "data-foco": `m${r.id}`,
      },
      h("span", { class: "parada-agarre", "aria-hidden": "true" }, "⠿"),
      h("span", { class: "ruta-num", "aria-hidden": "true" }, String(x.numero))
    );
    manija.addEventListener("pointerdown", (e) => arrastrar(e, manija));
    manija.addEventListener("keydown", (e) => {
      const vecino = e.key === "ArrowUp" ? f[k - 1] : e.key === "ArrowDown" ? f[k + 1] : undefined;
      if (!vecino) return;
      e.preventDefault();
      almacen.mover(r.id, vecino.r.id);
    });
    return h(
      "li",
      { class: `parada${x.visitada ? " visitada" : ""}`, style: `--cat:${cat.color}`, "data-id": r.id },
      manija,
      h(
        "button",
        { type: "button", class: "parada-texto", onclick: () => o.alAbrir(r) },
        h("span", { class: "fila-nombre" }, r.nombre),
        h("span", { class: "fila-meta" }, meta)
      ),
      h(
        "span",
        { class: "parada-controles" },
        visitada,
        boton("✕", () => almacen.alternar(r.id), "icono", { "aria-label": `Quitar ${r.nombre}` })
      )
    );
  }

  function vistaItinerario(i: Itinerario): (HTMLElement | null)[] {
    const f = filas(i);
    const conCoord = f.filter((x) => conPunto(x.r));
    const total = conCoord.slice(1).reduce((s, x, k) => s + distancia(conCoord[k].r as Coordenada, x.r as Coordenada), 0);
    const visitadas = f.filter((x) => x.visitada).length;
    const pendientes = conCoord.filter((x) => !x.visitada).map((x) => x.r as Coordenada);
    const google = enlaceIndicaciones(pendientes);

    const nombre = h("input", {
      class: "ruta-nombre",
      value: i.nombre,
      maxlength: 80,
      "aria-label": "Nombre de la ruta",
      "data-foco": "nombre",
    });
    nombre.addEventListener("change", () => almacen.renombrar(nombre.value));
    nombre.addEventListener("keydown", (e) => {
      if (e.key === "Enter") nombre.blur();
    });

    const resumen = [
      `${f.length} ${f.length === 1 ? "parada" : "paradas"}`,
      conCoord.length > 1 ? `${km(total)} en línea recta` : null,
      visitadas ? `${visitadas} ${visitadas === 1 ? "visitada" : "visitadas"}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return [
      // arriba para que se vea con la hoja plegada en el móvil
      panelSeguimiento(f),
      selector(i),
      nombre,
      h("p", { class: "ruta-resumen" }, resumen),
      f.length
        ? h(
            "div",
            { class: "d-acciones" },
            seguimiento ? null : boton("Seguir ruta", seguir, "boton"),
            conCoord.length ? boton("Ver en el mapa", verEnMapa) : null,
            google
              ? h(
                  "a",
                  {
                    class: "boton boton-sec",
                    href: google,
                    target: "_blank",
                    rel: "noopener",
                    title:
                      pendientes.length > MAX_INTERMEDIOS + 1
                        ? `Google Maps admite ${MAX_INTERMEDIOS + 1} paradas: se abren las próximas`
                        : undefined,
                  },
                  "Google Maps"
                )
              : null
          )
        : null,
      f.length
        ? h(
            "ol",
            { class: "paradas" },
            f.map((x, k) => filaParada(x, f, k))
          )
        : h(
            "p",
            { class: "ruta-ayuda" },
            "Aún no hay paradas. Usa «+» en la lista o «Agregar a la ruta» en la ficha de un recurso."
          ),
      h(
        "div",
        { class: "ruta-pie" },
        f.length ? boton("Compartir enlace", () => compartir(i), "enlace") : null,
        f.length ? boton("Exportar", () => exportar(i), "enlace") : null,
        boton("Importar", () => importador.click(), "enlace"),
        visitadas ? boton("Reiniciar visitas", () => almacen.reiniciarVisitas(), "enlace") : null,
        boton("Eliminar ruta", () => eliminar(i), "enlace enlace-peligro")
      ),
    ];
  }

  function pintar() {
    if (arrastrando) {
      repintarAlSoltar = true;
      return;
    }
    const foco = (document.activeElement as HTMLElement | null)?.dataset?.foco;
    const i = almacen.activo();
    contenedor.replaceChildren(
      h(
        "div",
        { class: "ruta-vista" },
        avisoCompartida(),
        ...(i ? vistaItinerario(i) : vistaVacia()),
        mensaje ? h("p", { class: "ruta-mensaje", role: "status" }, mensaje) : null,
        importador
      )
    );
    if (foco && contenedor.contains(document.activeElement) === false) {
      contenedor.querySelector<HTMLElement>(`[data-foco="${foco}"]:not([disabled])`)?.focus();
    }
    pintarMapa();
  }

  function pintarMapa() {
    const i = almacen.activo();
    const f = i ? filas(i) : [];
    const sig = siguiente(f);
    mapa.mostrarRuta(
      f.flatMap((x): ParadaMapa[] =>
        conPunto(x.r)
          ? [
              {
                id: x.r.id,
                nombre: x.r.nombre,
                lat: x.r.lat,
                lng: x.r.lng,
                numero: x.numero,
                visitada: x.visitada,
                siguiente: !!seguimiento && x === sig,
              },
            ]
          : []
      )
    );
  }

  function verEnMapa() {
    const i = almacen.activo();
    if (!i) return;
    const puntos: Coordenada[] = filas(i).flatMap((x) => (conPunto(x.r) ? [x.r] : []));
    if (seguimiento?.posicion) puntos.push(seguimiento.posicion);
    mapa.encuadrar(puntos);
  }

  almacen.alCambiar(pintar);

  return {
    pintar,
    verEnMapa,
    mostrarCompartida(c: { nombre: string; ids: number[] }) {
      compartida = c;
      pintar();
    },
  };
}
