// Vista de detalle de un recurso

import { CATEGORIAS, INGRESOS, JERARQUIAS, type Detalle, type Recurso } from "./data";
import { h, parrafos } from "./dom";

const fmt = new Intl.NumberFormat("es-PE");

function seccion(titulo: string, ...contenido: (Node | Node[] | null | false | undefined)[]): HTMLElement | null {
  const nodos = contenido.flat().filter((n): n is Node => !!n);
  if (!nodos.length) return null;
  return h("section", { class: "d-seccion" }, h("h3", null, titulo), ...nodos);
}

function texto(t: string | undefined, clase = "lectura"): HTMLElement[] | null {
  return t ? parrafos(t, clase) : null;
}

/** "Libre", "Previa presentación de boleto o ticket(especificar...)" -> texto simple */
function ingresoLegible(tipo: string | undefined): string | undefined {
  if (!tipo) return undefined;
  const t = tipo.toLowerCase();
  if (t.startsWith("libre")) return INGRESOS[1];
  if (t.includes("boleto")) return INGRESOS[2];
  if (t.includes("semi-restringido")) return INGRESOS[3];
  if (t.startsWith("otros")) return INGRESOS[4];
  return tipo;
}

function epocaLegible(e: string | undefined): string | undefined {
  if (!e) return undefined;
  if (e.startsWith("Otros [")) return "Otra época";
  if (e.startsWith("Esporádicamente")) return "Algunos meses del año";
  return e.charAt(0) + e.slice(1).toLowerCase();
}

function dato(etiqueta: string, valor: Node | string | null | undefined): HTMLElement | null {
  if (valor === null || valor === undefined || valor === "") return null;
  return h("div", { class: "d-dato" }, h("dt", null, etiqueta), h("dd", null, valor));
}

export function jerarquiaTexto(j: number, crudo?: string): string {
  if (j > 0) return `Jerarquía ${j} · ${JERARQUIAS[j]}`;
  if (crudo && /jerarquizar/i.test(crudo)) return "Por jerarquizar";
  return "Jerarquía no aplica";
}

/** Cabecera que se pinta al instante con los datos del índice */
export function cabecera(r: Recurso, alVolver: () => void): HTMLElement {
  const cat = CATEGORIAS[r.categoria];
  const lugar = [r.distrito, r.provincia !== r.distrito ? r.provincia : null, r.region].filter(Boolean).join(", ");
  return h(
    "header",
    { class: "d-cabecera", style: `--cat:${cat.color}` },
    h(
      "button",
      { type: "button", class: "volver", onclick: () => alVolver() },
      h("span", { "aria-hidden": "true" }, "←"),
      " Volver a la lista"
    ),
    h("p", { class: "d-categoria" }, h("span", { class: "punto", "aria-hidden": "true" }), cat.nombre),
    h("h2", { tabindex: "-1", id: "detalle-titulo" }, r.nombre),
    h("p", { class: "d-subtipo" }, [r.tipo, r.subtipo].filter(Boolean).join(" · ")),
    h("p", { class: "d-lugar" }, lugar),
    r.lat === null ? h("p", { class: "aviso" }, "Sin punto en el mapa: este recurso no tiene coordenadas en el inventario.") : null
  );
}

export function cuerpo(r: Recurso, d: Detalle): HTMLElement {
  const frag = h("div", { class: "d-cuerpo" });

  // Datos clave
  const ingreso = d.ingreso?.[0];
  const epoca = d.epoca?.[0];
  const clave = h(
    "dl",
    { class: "d-datos" },
    dato("Jerarquía", jerarquiaTexto(d.jerarquia, d.jerarquiaTexto)),
    dato("Altitud", d.altitud ? `${fmt.format(d.altitud)} m s. n. m.` : null),
    dato("Ingreso", ingresoLegible(ingreso?.tipo)),
    dato("Cuándo ir", [epocaLegible(epoca?.epoca), epoca?.detalle].filter(Boolean).join(": ") || null),
    dato("Horario", epoca?.horario)
  );
  if (clave.childElementCount) frag.append(clave);

  const acciones = h("div", { class: "d-acciones" });
  if (r.lat !== null && r.lng !== null) {
    acciones.append(
      h(
        "a",
        {
          class: "boton",
          href: `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`,
          target: "_blank",
          rel: "noopener",
        },
        "Abrir en Google Maps"
      )
    );
  }
  if (d.url) {
    acciones.append(
      h("a", { class: "boton boton-sec", href: d.url, target: "_blank", rel: "noopener" }, "Ficha de MINCETUR")
    );
  }
  frag.append(acciones);

  const notasIngreso = [ingreso?.detalle, epoca?.observacion].filter(Boolean) as string[];

  const bloques = [
    seccion("Descripción", texto(d.descripcion)),
    seccion("Particularidades", texto(d.particularidades)),
    seccion(
      "Ingreso y visita",
      notasIngreso.length ? notasIngreso.map((t) => h("p", null, t)) : null
    ),
    seccion("Cómo llegar", rutas(d)),
    seccion("Qué hacer", actividades(d)),
    seccion("Estado actual", texto(d.estado)),
    seccion("Reconocimientos", texto(d.reconocimientos)),
    seccion("Observaciones", texto(d.observaciones)),
    seccion("Visitantes", visitantes(d)),
    seccion("Accesibilidad", accesibilidad(d)),
    seccion("Servicios", servicios(d)),
  ];
  for (const b of bloques) if (b) frag.append(b);

  frag.append(
    h(
      "p",
      { class: "d-fuente" },
      `Código ${d.id} del Inventario Nacional de Recursos Turísticos (MINCETUR).`,
      d.fotos ? ` La ficha original tiene ${d.fotos} ${d.fotos === 1 ? "foto" : "fotos"}.` : null
    )
  );
  return frag;
}

function rutas(d: Detalle): HTMLElement[] | null {
  if (!d.rutas?.length) return null;
  const grupos = new Map<string, NonNullable<Detalle["rutas"]>>();
  for (const r of d.rutas) {
    const k = r.recorrido ?? "1";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }
  const varias = grupos.size > 1;
  return [...grupos.entries()].map(([k, tramos]) =>
    h(
      "div",
      { class: "ruta" },
      varias ? h("h4", null, `Recorrido ${k}`) : null,
      h(
        "ol",
        null,
        tramos.map((t) =>
          h(
            "li",
            null,
            h("p", { class: "ruta-tramo" }, t.detalle ?? t.tramo ?? "Tramo"),
            h(
              "p",
              { class: "ruta-meta" },
              [t.medio, t.via, t.acceso !== "Terrestre" ? t.acceso : null, t.distancia].filter(Boolean).join(" · ")
            )
          )
        )
      )
    )
  );
}

function actividades(d: Detalle): HTMLElement | null {
  const nombres = [
    ...new Set((d.actividades ?? []).map((a) => a.nombre).filter((n) => n && !/^otros\b/i.test(n))),
  ] as string[];
  if (!nombres.length) return null;
  return h("ul", { class: "etiquetas" }, nombres.map((n) => h("li", null, n.replace(/\s*\(Especificar\)/i, ""))));
}

function visitantes(d: Detalle): HTMLElement | null {
  const filas = (d.visitantes ?? []).filter((v) => v.tipo);
  if (!filas.length) return null;
  return h(
    "table",
    { class: "tabla" },
    h("thead", null, h("tr", null, h("th", null, "Tipo"), h("th", { class: "num" }, "Cantidad"), h("th", null, "Año"))),
    h(
      "tbody",
      null,
      filas.map((v) => {
        const n = Number(v.cantidad?.replace(/[.,\s]/g, ""));
        return h(
          "tr",
          null,
          h("td", null, v.tipo!),
          h("td", { class: "num" }, Number.isFinite(n) && v.cantidad ? fmt.format(n) : v.cantidad ?? ""),
          h("td", null, v.anio ?? "")
        );
      })
    )
  );
}

function accesibilidad(d: Detalle): HTMLElement[] | null {
  const filas = d.accesibilidad ?? [];
  if (!filas.length) return null;
  return filas.map((a) =>
    h(
      "dl",
      { class: "d-datos d-datos-compacto" },
      dato("Visitante", a.visitante),
      dato("Instalación", a.instalacion),
      dato("Programas", a.programas),
      dato("Equipamiento", a.equipamiento),
      dato("Nota", a.detalle)
    )
  );
}

function servicios(d: Detalle): HTMLElement[] | null {
  if (!d.servicios?.length) return null;
  return d.servicios.map((s) =>
    h(
      "details",
      { class: "plegable" },
      h("summary", null, s.titulo, h("span", { class: "contador" }, String(s.items.length))),
      h(
        "ul",
        null,
        s.items.map((i) =>
          h(
            "li",
            null,
            (i.nombre ?? i.grupo ?? "").replace(/\s*\(Especificar\)/i, ""),
            i.detalle ? h("span", { class: "nota" }, ` · ${i.detalle}`) : null
          )
        )
      )
    )
  );
}
