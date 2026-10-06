// Lista virtualizada: solo se dibujan las filas visibles

import { CATEGORIAS, type Recurso } from "./data";
import { h } from "./dom";

const ALTO_FILA = 64;
const EXTRA = 6;

export function crearLista(
  contenedor: HTMLElement,
  alto: HTMLElement,
  alElegir: (r: Recurso) => void
) {
  let items: Recurso[] = [];
  let pintadas = new Map<number, HTMLElement>();
  let pendiente = false;

  function fila(r: Recurso, i: number): HTMLElement {
    const cat = CATEGORIAS[r.categoria];
    const lugar = [r.distrito, r.region].filter(Boolean).join(", ");
    return h(
      "div",
      { role: "listitem", class: "fila", style: `transform:translateY(${i * ALTO_FILA}px)` },
      h(
        "button",
        {
          type: "button",
          class: "fila-boton",
          style: `--cat:${cat.color}`,
          "data-id": r.id,
          onclick: () => alElegir(r),
        },
        h("span", { class: `fila-punto${r.lat === null ? " sin-punto" : ""}`, "aria-hidden": "true" }),
        h(
          "span",
          { class: "fila-texto" },
          h("span", { class: "fila-nombre" }, r.nombre),
          h(
            "span",
            { class: "fila-meta" },
            [r.subtipo, lugar].filter(Boolean).join(" · "),
            r.lat === null ? h("span", { class: "fila-sin" }, " · sin punto en el mapa") : null
          )
        ),
        r.jerarquia > 0
          ? h("span", { class: `fila-jer j${r.jerarquia}`, title: `Jerarquía ${r.jerarquia}` }, String(r.jerarquia))
          : null
      )
    );
  }

  function pintar() {
    pendiente = false;
    const desde = Math.max(0, Math.floor(contenedor.scrollTop / ALTO_FILA) - EXTRA);
    const hasta = Math.min(items.length, Math.ceil((contenedor.scrollTop + contenedor.clientHeight) / ALTO_FILA) + EXTRA);
    const nuevas = new Map<number, HTMLElement>();
    for (let i = desde; i < hasta; i++) {
      const el = pintadas.get(i) ?? fila(items[i], i);
      nuevas.set(i, el);
      if (!el.isConnected) alto.append(el);
    }
    for (const [i, el] of pintadas) if (!nuevas.has(i)) el.remove();
    pintadas = nuevas;
  }

  function programar() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  }

  contenedor.addEventListener("scroll", programar, { passive: true });
  new ResizeObserver(programar).observe(contenedor);

  return {
    actualizar(nuevos: Recurso[], volverArriba: boolean) {
      items = nuevos;
      for (const el of pintadas.values()) el.remove();
      pintadas.clear();
      alto.style.height = `${items.length * ALTO_FILA}px`;
      if (volverArriba) contenedor.scrollTop = 0;
      pintar();
    },
  };
}
