// Initialize map centered on Peru
const map = L.map("map").setView([-9.19, -75.0], 6);

// Add OpenStreetMap tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 18,
}).addTo(map);

const categoryColors = {
  "1. SITIOS NATURALES": "#2ecc71",
  "2. MANIFESTACIONES CULTURALES": "#3498db",
  "3. FOLCLORE": "#f1c40f",
  "4. REALIZACIONES TECNICAS, CIENTIFICAS O ARTISTICAS CONTEMPORANEAS":
    "#9b59b6",
  "5. ACONTECIMIENTOS PROGRAMADOS": "#e74c3c",
};

function getCategoryClass(category) {
  if (category.includes("NATURALES")) return "natural";
  if (category.includes("CULTURALES")) return "cultural";
  if (category.includes("FOLCLORE")) return "folclore";
  if (category.includes("ACONTECIMIENTOS")) return "eventos";
  return "tecnico";
}

function createMarkerIcon(color) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
            background-color: ${color};
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6],
  });
}

function createPopupContent(row) {
  const categoryClass = getCategoryClass(
    row["CATEGORÍA"] || row["CATEGORIA"] || ""
  );
  const name = row["NOMBRE DEL RECURSO"] || "Sin nombre";
  const category = row["CATEGORÍA"] || row["CATEGORIA"] || "Sin categoría";
  const type = row["TIPO DE CATEGORÍA"] || row["TIPO DE CATEGORIA"] || "";
  const subtype = row["SUB TIPO CATEGORÍA"] || row["SUB TIPO CATEGORIA"] || "";
  const region = row["REGIÓN"] || row["REGION"] || "";
  const province = row["PROVINCIA"] || "";
  const district = row["DISTRITO"] || "";
  const url = row["URL"] || "";

  let html = `
        <div class="popup-title">${name}</div>
        <span class="popup-category ${categoryClass}">${category.replace(
    /^\d+\.\s*/,
    ""
  )}</span>
        <div class="popup-location">${district}, ${province}, ${region}</div>
    `;

  if (type || subtype) {
    html += `<div class="popup-type">${type}${
      subtype ? " - " + subtype : ""
    }</div>`;
  }

  // Link to MINCETUR ficha
  if (url) {
    html += `<a href="${url}" target="_blank" class="popup-link">Ver ficha completa</a>`;
  }

  return html;
}

const markers = L.markerClusterGroup({
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
});

const loadingEl = document.createElement("div");
loadingEl.className = "loading";
loadingEl.textContent = "Cargando recursos turisticos...";
document.body.appendChild(loadingEl);

Papa.parse("Inventario_recursos_turisticos.csv", {
  download: true,
  header: true,
  delimiter: ";",
  complete: function (results) {
    let count = 0;
    const resourcesWithoutLocation = [];

    results.data.forEach((row) => {
      let lat = parseFloat(row["LATITUD"]);
      let lng = parseFloat(row["LONGITUD"]);

      const hasValidCoords = !isNaN(lat) && !isNaN(lng);
      let isValidLocation = false;

      if (hasValidCoords) {
        // The CSV has longitude in LATITUD and latitude in LONGITUD (swapped)
        // Peru is roughly between lat -0 to -18 and lng -68 to -82
        // If lat is in the range of Peru's longitude, swap them
        if (lat < -60 || lat > 0) {
          [lat, lng] = [lng, lat];
        }

        // Validate coordinates are within Peru bounds (roughly)
        isValidLocation = lat >= -20 && lat <= 0 && lng >= -85 && lng <= -65;
      }

      if (!isValidLocation) {
        const name = row["NOMBRE DEL RECURSO"] || "Sin nombre";
        const region = row["REGIÓN"] || row["REGION"] || "Sin region";
        const category = row["CATEGORÍA"] || row["CATEGORIA"] || "";
        const codigo = row["CODIGO DEL RECURSO"] || "";
        const url = row["URL"] || "";

        if (name && name.trim()) {
          resourcesWithoutLocation.push({
            name,
            region,
            category,
            codigo,
            url,
          });
        }
        return;
      }

      const category = row["CATEGORÍA"] || row["CATEGORIA"] || "";
      const color = categoryColors[category] || "#95a5a6";

      const marker = L.marker([lat, lng], {
        icon: createMarkerIcon(color),
      });

      marker.bindPopup(createPopupContent(row), {
        maxWidth: 300,
      });

      markers.addLayer(marker);
      count++;
    });

    map.addLayer(markers);

    document.getElementById("count").textContent = count.toLocaleString();

    renderNoLocationPanel(resourcesWithoutLocation);

    loadingEl.remove();

    console.log(`Loaded ${count} tourist resources`);
    console.log(
      `${resourcesWithoutLocation.length} resources without valid location`
    );
  },
  error: function (error) {
    loadingEl.textContent = "Error al cargar los datos";
    console.error("Error loading CSV:", error);
  },
});

function renderNoLocationPanel(resources) {
  const countEl = document.getElementById("no-location-count");
  const listEl = document.getElementById("no-location-list");

  if (!countEl || !listEl) return;

  countEl.textContent = resources.length;

  const byRegion = {};
  resources.forEach((r) => {
    if (!byRegion[r.region]) byRegion[r.region] = [];
    byRegion[r.region].push(r);
  });

  const sortedRegions = Object.keys(byRegion).sort();

  let html = "";
  sortedRegions.forEach((region) => {
    const regionResources = byRegion[region];
    html += `
      <div class="region-group">
        <div class="region-header" data-region="${region}">
          <span class="region-toggle">+</span>
          <span class="region-name">${region}</span>
          <span class="region-count">(${regionResources.length})</span>
        </div>
        <div class="region-items" style="display: none;">
    `;

    regionResources.forEach((r) => {
      const categoryClass = getCategoryClass(r.category);
      const cleanCategory = r.category.replace(/^\d+\.\s*/, "");

      html += `
        <a href="${r.url}" target="_blank" class="resource-item">
          <span class="resource-name">${r.name}</span>
          <span class="resource-category ${categoryClass}">${cleanCategory}</span>
        </a>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll(".region-header").forEach((header) => {
    header.addEventListener("click", () => {
      const items = header.nextElementSibling;
      const toggle = header.querySelector(".region-toggle");
      const isHidden = items.style.display === "none";
      items.style.display = isHidden ? "block" : "none";
      toggle.textContent = isHidden ? "-" : "+";
    });
  });
}

// Panel toggle
document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("no-location-panel");
  const toggle = panel?.querySelector(".panel-toggle");

  if (toggle) {
    toggle.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
    });
  }
});
