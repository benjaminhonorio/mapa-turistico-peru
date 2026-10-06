// Construcción de nodos sin innerHTML: los textos vienen de una fuente externa

type Hijo = Node | string | number | null | undefined | false;
type Atributos = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Atributos | null = null,
  ...hijos: (Hijo | Hijo[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
      else if (k === "class") el.className = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return el;
}

/** Párrafos a partir de un texto con saltos de línea */
export function parrafos(texto: string, clase?: string): HTMLElement[] {
  return texto
    .split(/\n\s*\n|\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => h("p", clase ? { class: clase } : null, t));
}
