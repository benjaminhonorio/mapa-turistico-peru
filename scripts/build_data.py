#!/usr/bin/env python3
"""Convierte las fichas de MINCETUR (data/recursos/{Region}/{codigo}.json) en datos livianos para la web.

Genera en public/data/:
  index.json        todos los recursos con lo necesario para mapa, lista y filtros
  r/{codigo}.json   detalle de cada recurso, cargado a demanda

Uso:
  python3 scripts/build_data.py [--data ../data] [--csv Inventario_recursos_turisticos.csv]
"""

import argparse
import csv
import gzip
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"

EMPTY = {"", "--", "-", "---"}

JERARQUIA = {"4": 4, "3": 3, "2": 2, "1": 1}

# Tipo de ingreso normalizado: 0 sin dato, 1 libre, 2 con boleto, 3 con permiso, 4 otro
INGRESO = [
    ("libre", 1),
    ("boleto", 2),
    ("semi-restringido", 3),
    ("otros", 4),
]

# Palabras que van en minúscula dentro de un nombre (no al inicio)
MINUSCULAS = {"de", "del", "y", "e", "en", "a", "al", "con", "por", "para", "o", "u"}
ARTICULOS = {"la", "las", "los", "el"}
ROMANOS = re.compile(r"^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$", re.I)


def titulo(texto: str) -> str:
    """Title Case en español: 'SAN JUAN DE LA FRONTERA' -> 'San Juan de la Frontera'."""
    palabras = texto.strip().split()
    salida = []
    previa_minuscula = False
    for i, palabra in enumerate(palabras):
        base = palabra.lower()
        nucleo = base.strip("()\"'“”.,;:")
        if i > 0 and nucleo in MINUSCULAS and nucleo == base:
            salida.append(base)
            previa_minuscula = True
            continue
        if i > 0 and previa_minuscula and nucleo in ARTICULOS and nucleo == base:
            salida.append(base)
            continue
        previa_minuscula = False
        if nucleo and ROMANOS.match(nucleo) and len(nucleo) > 1 and nucleo not in {"mil", "di", "vi", "li"}:
            salida.append(base.upper())
            continue
        # Capitaliza cada tramo separado por guion o barra, respetando signos iniciales
        salida.append(re.sub(r"(^|[-/(\"“'])(\w)", lambda m: m.group(1) + m.group(2).upper(), base))
    return " ".join(salida)


def limpio(valor):
    """Devuelve el texto sin espacios sobrantes o None si está vacío ('--')."""
    if valor is None:
        return None
    texto = re.sub(r"[ \t]+", " ", str(valor)).strip()
    return None if texto in EMPTY else texto


def sin_literal(texto):
    """Quita el literal con que MINCETUR enumera los tipos de sitios naturales ('j. Caídas de agua')."""
    return re.sub(r"^[a-zñ]\.\s*", "", texto) if texto else texto


def filas(secciones: dict, titulo_seccion: str, campos: dict) -> list:
    """Extrae filas de una sección tabla renombrando campos y quitando vacíos."""
    salida = []
    for fila in secciones.get(titulo_seccion) or []:
        if not isinstance(fila, dict):
            continue
        nueva = {}
        for origen, destino in campos.items():
            v = limpio(fila.get(origen))
            if v is not None:
                nueva[destino] = v
        if nueva:
            salida.append(nueva)
    return salida


def ingreso_normalizado(filas_ingreso: list) -> int:
    if not filas_ingreso:
        return 0
    tipo = (filas_ingreso[0].get("tipo") or "").lower()
    for clave, valor in INGRESO:
        if tipo.startswith(clave) or clave in tipo:
            return valor
    return 4


def numero(texto, tipo=float):
    try:
        return tipo(str(texto).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def total_visitantes(filas_visitantes: list) -> int:
    """Suma de visitantes del año más reciente registrado (sirve para desempatar etiquetas)."""
    por_anio = {}
    for f in filas_visitantes:
        cantidad = numero(re.sub(r"[.\s]", "", f.get("cantidad", "")), int)
        anio = numero(f.get("anio"), int) or 0
        if cantidad:
            por_anio[anio] = por_anio.get(anio, 0) + cantidad
    return por_anio[max(por_anio)] if por_anio else 0


def coordenadas(ficha: dict):
    # En la fuente vienen invertidas: "latitud" trae la longitud y viceversa
    lng = numero(ficha.get("latitud"))
    lat = numero(ficha.get("longitud"))
    if lat is None or lng is None:
        return None, None
    return round(lat, 5), round(lng, 5)


SERVICIOS = [
    ("Servicios turísticos dentro del recurso", "Servicios Turísticos actuales dentro del recurso",
     {"Tipo de Servicio": "nombre", "Servicio": "grupo", "Instalación": "instalacion", "Observación": "detalle"}),
    ("Servicios complementarios dentro del recurso", "Servicios Complementarios dentro del recurso",
     {"Servicio Complementario": "nombre", "Observación": "detalle"}),
    ("Infraestructura básica dentro del recurso", "Infraestructura básica dentro del recurso",
     {"Infraestructura": "nombre", "Observación": "detalle"}),
    ("Servicios turísticos cerca del recurso", "Servicios Turísticos actuales fuera del recurso",
     {"Tipo de Servicio": "nombre", "Servicio": "grupo", "Observación": "detalle"}),
    ("Servicios complementarios cerca del recurso", "Servicios Complementarios fuera del recurso",
     {"Servicio": "nombre", "Observación": "detalle"}),
    ("Infraestructura básica cerca del recurso", "Infraestructura básica fuera del recurso",
     {"Infraestructura": "nombre", "Observación": "detalle"}),
]


class Diccionario:
    """Asigna un índice estable a cada valor repetido."""

    def __init__(self):
        self.valores = []
        self.indices = {}

    def __call__(self, valor):
        if valor is None:
            return -1
        if valor not in self.indices:
            self.indices[valor] = len(self.valores)
            self.valores.append(valor)
        return self.indices[valor]


def leer_csv(ruta: Path):
    codigos, fecha = set(), None
    if not ruta.exists():
        return None, None
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        for fila in csv.DictReader(f, delimiter=";"):
            codigo = (fila.get("CODIGO DEL RECURSO") or "").strip()
            if codigo:
                codigos.add(codigo)
            fecha = fecha or (fila.get("FECHA_DE_CORTE") or "").strip() or None
    return codigos, fecha


def construir(data_dir: Path, csv_path: Path):
    recursos_dir = data_dir / "recursos"
    if not recursos_dir.is_dir():
        sys.exit(
            f"Error: no encuentro la carpeta de fichas en {recursos_dir}\n"
            "Indica la carpeta de datos con --data /ruta/a/data (debe contener recursos/{Region}/{codigo}.json)."
        )
    archivos = sorted(recursos_dir.glob("*/*.json"))
    if not archivos:
        sys.exit(f"Error: {recursos_dir} no tiene fichas JSON.")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "r").mkdir(parents=True)

    tipos, subtipos, regiones, provincias, distritos, actividades = (Diccionario() for _ in range(6))
    filas_indice = []
    errores = []
    sin_coords = 0

    for archivo in archivos:
        try:
            ficha = json.loads(archivo.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            errores.append(f"{archivo}: {e}")
            continue

        codigo = int(ficha["codigo"])
        secciones = {s["titulo"]: s["contenido"] for s in ficha.get("secciones", [])}
        textos = {k: limpio(v) for k, v in secciones.items() if isinstance(v, str)}

        categoria = int(ficha["categoria"].split(".")[0])
        jerarquia = JERARQUIA.get(str(ficha.get("jerarquia", "")).strip(), 0)
        lat, lng = coordenadas(ficha)
        if lat is None:
            sin_coords += 1
        altitud = numero(ficha.get("altitud_msnm"), int)
        nombre = titulo(ficha["nombre"])
        region = titulo(ficha["region"])
        provincia = titulo(ficha["provincia"])
        distrito = titulo(ficha["distrito"])
        tipo = sin_literal(limpio(ficha.get("tipo")))
        subtipo = limpio(ficha.get("subtipo"))

        ingreso = filas(secciones, "Tipo de ingreso", {"Tipo de ingreso": "tipo", "Observaciones": "detalle"})
        nombres_actividades = sorted(
            {a["nombre"].strip() for a in ficha.get("actividades_principales") or [] if limpio(a.get("nombre"))}
        )
        fotos = len(ficha.get("imagenes_local") or [])
        visitantes = filas(secciones, "Tipo de Visitante", {
            "Tipo de Visitante": "tipo",
            "Cantidad": "cantidad",
            "Fuente de datos": "fuente",
            "Año": "anio",
            "Observación": "detalle",
        })

        filas_indice.append([
            codigo,
            nombre,
            categoria,
            tipos(tipo),
            subtipos(subtipo),
            regiones(region),
            provincias(provincia),
            distritos(distrito),
            jerarquia,
            lat,
            lng,
            altitud,
            [actividades(a) for a in nombres_actividades],
            ingreso_normalizado(ingreso),
            fotos,
            total_visitantes(visitantes),
        ])

        servicios = []
        for titulo_ui, titulo_fuente, campos in SERVICIOS:
            items = filas(secciones, titulo_fuente, campos)
            if items:
                servicios.append({"titulo": titulo_ui, "items": items})

        detalle = {
            "id": codigo,
            "nombre": nombre,
            "categoria": categoria,
            "tipo": tipo,
            "subtipo": subtipo,
            "region": region,
            "provincia": provincia,
            "distrito": distrito,
            "jerarquia": jerarquia,
            "jerarquiaTexto": limpio(ficha.get("jerarquia")),
            "altitud": altitud,
            "lat": lat,
            "lng": lng,
            "fotos": fotos,
            "url": ficha.get("url_ficha"),
            "descripcion": textos.get("Descripción"),
            "estado": textos.get("Estado actual"),
            "particularidades": textos.get("Particularidades"),
            "reconocimientos": textos.get("Reconocimientos"),
            "observaciones": textos.get("Observaciones"),
            "ingreso": ingreso,
            "epoca": filas(secciones, "Época propicia de visita al recurso", {
                "Época propicia de visita al recurso": "epoca",
                "Especificación": "detalle",
                "Hora de visita especificación": "horario",
                "Observaciones": "observacion",
            }),
            "rutas": filas(secciones, "Ruta de acceso al recurso", {
                "Recorrido": "recorrido",
                "Tramo": "tramo",
                "Detalle": "detalle",
                "Tipo de Acceso": "acceso",
                "Medio de transporte": "medio",
                "Tipo de Vía Terrestre": "via",
                "Distancia en kms./tiempo": "distancia",
            }),
            "actividades": filas(secciones, "Actividades desarrolladas dentro del recurso turístico", {
                "tipo": "nombre",
                "actividad": "grupo",
                "observacion": "detalle",
            }),
            "visitantes": visitantes,
            "accesibilidad": filas(secciones, "Condiciones de Accesibilidad al Visitante", {
                "Visitante": "visitante",
                "Instalación": "instalacion",
                "Actividades y/o programas": "programas",
                "Equipamiento": "equipamiento",
                "Observación": "detalle",
            }),
            "servicios": servicios,
        }
        detalle = {k: v for k, v in detalle.items() if v not in (None, [], "")}
        (OUT / "r" / f"{codigo}.json").write_text(
            json.dumps(detalle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    codigos_csv, fecha_corte = leer_csv(csv_path)
    codigos_json = {str(f[0]) for f in filas_indice}

    indice = {
        "fechaCorte": fecha_corte,
        "dic": {
            "tipos": tipos.valores,
            "subtipos": subtipos.valores,
            "regiones": regiones.valores,
            "provincias": provincias.valores,
            "distritos": distritos.valores,
            "actividades": actividades.valores,
        },
        "campos": [
            "id", "nombre", "categoria", "tipo", "subtipo", "region", "provincia", "distrito",
            "jerarquia", "lat", "lng", "altitud", "actividades", "ingreso", "fotos", "visitantes",
        ],
        "recursos": filas_indice,
    }
    texto_indice = json.dumps(indice, ensure_ascii=False, separators=(",", ":"))
    (OUT / "index.json").write_text(texto_indice, encoding="utf-8")

    # Resumen
    bytes_indice = len(texto_indice.encode("utf-8"))
    gzip_indice = len(gzip.compress(texto_indice.encode("utf-8"), 9))
    detalles = list((OUT / "r").glob("*.json"))
    bytes_detalle = sum(p.stat().st_size for p in detalles)

    def mb(n):
        return f"{n / 1024 / 1024:.1f} MB" if n > 1024 * 1024 else f"{n / 1024:.0f} KB"

    print(f"Fichas leídas:        {len(filas_indice):,}")
    print(f"  con coordenadas:    {len(filas_indice) - sin_coords:,}")
    print(f"  sin coordenadas:    {sin_coords:,}")
    por_categoria = {}
    for f in filas_indice:
        por_categoria[f[2]] = por_categoria.get(f[2], 0) + 1
    print("  por categoría:      " + ", ".join(f"{k}: {v:,}" for k, v in sorted(por_categoria.items())))
    if errores:
        print(f"Fichas con error ({len(errores)}):")
        for e in errores:
            print(f"  {e}")
    if codigos_csv is None:
        print(f"CSV no encontrado en {csv_path}: no se compararon faltantes")
    else:
        faltan = sorted(codigos_csv - codigos_json, key=int)
        sobran = sorted(codigos_json - codigos_csv, key=int)
        print(f"CSV:                  {len(codigos_csv):,} códigos (fecha de corte {fecha_corte})")
        print(f"  en el CSV sin ficha: {len(faltan)}" + (f" -> {', '.join(faltan)}" if faltan else ""))
        print(f"  con ficha sin CSV:   {len(sobran)}" + (f" -> {', '.join(sobran)}" if sobran else ""))
    print(f"Salida en {OUT.relative_to(ROOT)}/")
    print(f"  index.json:         {mb(bytes_indice)} ({mb(gzip_indice)} con gzip)")
    print(f"  r/*.json:           {len(detalles):,} archivos, {mb(bytes_detalle)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=ROOT.parent / "data",
                        help="carpeta de datos que contiene recursos/ (por defecto ../data)")
    parser.add_argument("--csv", type=Path, default=ROOT / "Inventario_recursos_turisticos.csv",
                        help="CSV del inventario para comparar códigos y leer la fecha de corte")
    args = parser.parse_args()
    construir(args.data.expanduser().resolve(), args.csv)


if __name__ == "__main__":
    main()
