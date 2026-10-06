# Mapa turístico del Perú

Mapa interactivo de los 5,585 recursos del Inventario Nacional de Recursos Turísticos (MINCETUR), construido a partir de las fichas completas.

Demo: https://benjaminhonorio.github.io/mapa-turistico-peru/

## Qué hace

- Mapa con MapLibre GL, sin clustering: color por categoría, tamaño y prioridad de etiqueta según la jerarquía de MINCETUR (la 4 se ve desde la vista de país, luego 3, 2 y el resto al acercarse).
- Búsqueda sin tildes ni mayúsculas (nombre, subtipo, distrito, provincia), categorías como chips que sirven de leyenda, filtros por región, jerarquía mínima, actividad, ingreso libre y zona visible.
- Lista ordenada por jerarquía y nombre, que incluye los recursos sin coordenadas (fiestas, platos, danzas) marcados como "sin punto".
- Detalle de la ficha: descripción, ingreso, época y horario, cómo llegar, actividades, servicios, visitantes y enlaces a Google Maps y a la ficha original.
- Estado en la URL (`?r=<código>&q=...&region=...`) para compartir enlaces.

## Desarrollo

Requiere Node 24+ y Python 3.

```sh
npm install
npm run data    # regenera public/data desde ../data/recursos
npm run dev     # http://localhost:4321/mapa-turistico-peru/
npm run build   # astro check + sitio estático en dist/
```

## Datos

`scripts/build_data.py` (solo librería estándar) lee `../data/recursos/{Region}/{codigo}.json` y genera:

- `public/data/index.json`: todos los recursos con lo necesario para mapa, lista y filtros, con diccionarios para los valores repetidos (~570 KB, ~190 KB con gzip).
- `public/data/r/{codigo}.json`: el detalle de cada recurso, que se carga al abrir la ficha (~37 MB en total).

Con `--data /ruta/a/data` se usa otra carpeta. El script invierte latitud y longitud (vienen cruzadas en la fuente), quita los `--`, descarta "Datos del Responsable" y "Saneamiento Físico Legal", y compara los códigos con `Inventario_recursos_turisticos.csv` (el scraper también lo lee desde esta ruta).

Los datos generados se versionan porque el deploy no tiene acceso a la fuente.

## Fuentes

- Datos: [Inventario Nacional de Recursos Turísticos](https://www.datosabiertos.gob.pe/dataset/inventario-nacional-de-recursos-tur%C3%ADsticos), MINCETUR, licencia ODC-BY.
- Mapa base: [OpenFreeMap](https://openfreemap.org), © colaboradores de OpenStreetMap.
- Relieve: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) en AWS.
- Tipografías: Bricolage Grotesque y Literata, autoalojadas con Fontsource.
