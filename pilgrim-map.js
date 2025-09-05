
/*! Pilgrim Map Kit — creates a branded Leaflet map (GPX or GeoJSON) with optional elevation chart.
 *  Dependencies are auto-loaded once per page:
 *    - Leaflet 1.9.x
 *    - leaflet-gpx 1.7.x (for GPX)
 *    - Chart.js 4.x (for elevation chart)
 */
(function (global) {
  const PMK = global.PilgrimMapKit = global.PilgrimMapKit || {};

  function ensureLeafletCss() {
    // Add Leaflet CSS once if missing
    const exists = !!document.querySelector('link[data-pmk-leaflet]');
    if (exists) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.crossOrigin = 'anonymous';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.setAttribute('data-pmk-leaflet', 'true');
    document.head.appendChild(link);
  }

  function loadScriptOnce(url, key) {
    PMK._scriptCache = PMK._scriptCache || {};
    if (PMK._scriptCache[key]) return PMK._scriptCache[key];
    PMK._scriptCache[key] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    });
    return PMK._scriptCache[key];
  }

  function ensureLibs(opts = {}) {
    ensureLeafletCss();
    const wantsChart = opts.wantsChart !== false;
    const wantsGPX = opts.wantsGPX !== false;
    const p = [];
    p.push(loadScriptOnce('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet'));
    if (wantsGPX) {
      p.push(loadScriptOnce('https://cdn.jsdelivr.net/npm/leaflet-gpx@1.7.0/dist/leaflet-gpx.min.js', 'leaflet-gpx'));
    }
    if (wantsChart) {
      p.push(loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', 'chart'));
    }
    return Promise.all(p);
  }

  function el(tag, className, parent) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function toRad(deg) { return deg * Math.PI / 180; }
  function haversineMiles(a, b) {
    const R_km = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const A = Math.sin(dLat/2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon/2) ** 2;
    const d_km = 2 * R_km * Math.asin(Math.sqrt(A));
    return d_km * 0.621371;
  }

  function parseGPXToSeries(gpxXml) {
    const xml = new DOMParser().parseFromString(gpxXml, 'application/xml');
    const trks = Array.from(xml.getElementsByTagName('trk'));
    if (!trks.length) throw new Error('No <trk> in GPX');

    const pts = [];
    const stageEndIdx = [];
    trks.forEach(trk => {
      const ptsInTrk = Array.from(trk.getElementsByTagName('trkpt')).map(pt => ({
        lat: parseFloat(pt.getAttribute('lat')),
        lon: parseFloat(pt.getAttribute('lon')),
        ele: parseFloat(pt.getElementsByTagName('ele')[0]?.textContent ?? '0')
      }));
      pts.push(...ptsInTrk);
      stageEndIdx.push(pts.length - 1);
    });

    // Build cumulative distance (miles) and elevation (feet)
    const distMi = [0];
    const elevFt = [ (pts[0]?.ele ?? 0) * 3.28084 ];
    for (let i = 1; i < pts.length; i++) {
      distMi.push(distMi[i-1] + haversineMiles(pts[i-1], pts[i]));
      const ele = isFinite(pts[i].ele) ? pts[i].ele : (elevFt[i-1] / 3.28084);
      elevFt.push(ele * 3.28084);
    }

    const totalMi = distMi[distMi.length - 1];
    const stageScatter = stageEndIdx.filter(idx => idx > 0).map((idx, s) => ({
      x: distMi[idx], y: elevFt[idx], _isFinal: s === stageEndIdx.length - 1
    }));

    return { pts, distMi, elevFt, totalMi, stageScatter };
  }

  function addCityMarkers(map, cities = []) {
    cities.forEach(c => {
      const m = L.marker([c.lat, c.lon]).addTo(map);
      if (c.popup) m.bindPopup(c.popup);
      const label = c.label || c.name;
      if (label) {
        m.bindTooltip(label, {
          permanent: true,
          direction: 'top',
          className: 'city-label',
          offset: [0, -14]
        });
      }
    });
  }

  function defaultTileLayer() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    });
  }

  // Cursor line plugin for Chart.js
  const cursorLinePlugin = {
    id: 'pmkCursorLine',
    afterDatasetsDraw(chart) {
      const { ctx, tooltip, chartArea } = chart;
      if (!tooltip || !tooltip.getActiveElements().length) return;
      const x = tooltip.caretX;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = getComputedStyle(chart.canvas).getPropertyValue('--pm-color-primary').trim() || '#1976d2';
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  async function createPilgrimMap(opts) {
    const {
      wrapper,                 // selector or Element
      gpxUrl,                  // optional
      geojsonUrl,              // optional
      geojson,                 // optional (object)
      cities = [],             // [{name, lat, lon, popup?}]
      units = 'imperial',      // 'imperial' | 'metric'
      showElevation = true,    // only meaningful for GPX
      tile = defaultTileLayer, // function returning an L.TileLayer
      line = { color: undefined, weight: 4, opacity: 1 },
      logoUrl = 'https://aarondsmith.github.io/pilgrims-path-assets/logo.png',
      logoLink = '/',          // click-through URL (opens new tab)
      brandText = 'Pilgrim’s Path'
    } = opts || {};

    if (!wrapper) throw new Error('wrapper is required');
    const root = (typeof wrapper === 'string') ? document.querySelector(wrapper) : wrapper;
    if (!root) throw new Error('wrapper element not found');

    // Build DOM skeleton if empty
    root.classList.add('pilgrim-map');
    let container = root.querySelector('.pm-container');
    if (!container) {
      container = el('div', 'pm-container', root);
      const brand = el('a', 'pm-brand', container);
      brand.href = logoLink || '/';
      brand.target = '_blank';
      const img = el('img', '', brand);
      img.src = logoUrl;
      img.alt = 'Logo';
      const span = el('span', '', brand);
      span.textContent = brandText;

      const mapDiv = el('div', 'pm-map', container);
      mapDiv.id = 'pm-map-' + Math.random().toString(36).slice(2, 9);

      const card = el('div', 'pm-elev-card', container);
      const canvas = el('canvas', 'pm-elev-canvas', card);
      canvas.id = mapDiv.id + '-elev';

      el('div', 'pm-error', container);
    }

    const mapDiv = container.querySelector('.pm-map');
    const canvas = container.querySelector('.pm-elev-canvas');
    const errBox = container.querySelector('.pm-error');
    const showError = (msg) => {
      if (!errBox) return;
      errBox.textContent = 'Map/Elevation error: ' + msg;
      errBox.style.display = 'block';
    };

    // Decide which libs are needed
    const needsChart = !!gpxUrl && showElevation;
    const needsGPX = !!gpxUrl;
    await ensureLibs({ wantsChart: needsChart, wantsGPX: needsGPX });

    if (!global.L) throw new Error('Leaflet failed to load');
    if (gpxUrl && !global.L.GPX) throw new Error('leaflet-gpx failed to load');
    if (needsChart && !global.Chart) throw new Error('Chart.js failed to load');

    const map = L.map(mapDiv);
    const tl = (typeof tile === 'function') ? tile() : defaultTileLayer();
    tl.addTo(map);

    // Route line style
    const color = line.color || getComputedStyle(root).getPropertyValue('--pm-color-primary').trim() || '#1976d2';
    const lineOpts = { color, weight: line.weight ?? 4, opacity: line.opacity ?? 1 };

    let cursorMarker = null;
    let chart = null;

    // Helper to add cursor marker
    function ensureCursorMarker(latlng) {
      if (cursorMarker) return cursorMarker;
      cursorMarker = L.circleMarker(latlng, {
        radius: 6,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 1
      }).addTo(map);
      cursorMarker.setStyle({ opacity: 0, fillOpacity: 0 });
      return cursorMarker;
    }

    try {
      if (gpxUrl) {
        // Draw GPX
        const gpxLayer = new L.GPX(gpxUrl, {
          async: true,
          polyline_options: lineOpts,
          marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null }
        })
        .on('loaded', e => map.fitBounds(e.target.getBounds()))
        .on('error', () => showError('Could not load GPX on the map.'))
        .addTo(map);

        // Cities after GPX loads (so bounds exist)
        gpxLayer.on('loaded', () => addCityMarkers(map, cities));

        // Elevation (parse GPX directly)
        if (showElevation) {
          const res = await fetch(gpxUrl, { cache: 'no-store' });
          if (!res.ok) throw new Error('Failed to fetch GPX (' + res.status + ')');
          const gpxText = await res.text();
          const { pts, distMi, elevFt, totalMi, stageScatter } = parseGPXToSeries(gpxText);

          const ctx = canvas.getContext('2d');
          const cursorLine = cursorLinePlugin;
          const data = distMi.map((x, i) => ({ x, y: elevFt[i] }));

          chart = new Chart(ctx, {
            type: 'line',
            data: {
              datasets: [
                { label: 'Elevation',
                  data,
                  borderColor: color,
                  backgroundColor: 'rgba(25,118,210,0.10)',
                  borderWidth: 2,
                  pointRadius: 0,
                  tension: 0.2,
                  fill: true },
                { type: 'scatter',
                  data: stageScatter,
                  parsing: false,
                  showLine: false,
                  pointStyle: 'circle',
                  pointBackgroundColor: getComputedStyle(root).getPropertyValue('--pm-color-accent').trim() || '#003366',
                  pointBorderColor: getComputedStyle(root).getPropertyValue('--pm-color-accent').trim() || '#003366',
                  pointBorderWidth: 1,
                  pointRadius: 3,
                  pointHoverRadius: 5 }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'nearest', intersect: false, axis: 'x' },
              plugins: { legend: { display: false } },
              parsing: false,
              scales: {
                x: { type: 'linear', min: 0, max: totalMi,
                     ticks: { callback: v => Math.round(v) + ' mi' },
                     title: { display: true, text: 'Distance (mi)' } },
                y: { title: { display: true, text: 'Elevation (ft)' },
                     ticks: { callback: v => Math.round(v) + ' ft' } }
              }
            },
            plugins: [cursorLine]
          });

          // Sync mouse with map
          function kmToIndex(mi) {
            let lo = 0, hi = distMi.length - 1;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (distMi[mid] < mi) lo = mid + 1; else hi = mid;
            }
            const i2 = lo;
            const i1 = Math.max(0, lo - 1);
            return (Math.abs(distMi[i1] - mi) <= Math.abs(distMi[i2] - mi)) ? i1 : i2;
          }

          const updateFromEvent = (evt) => {
            const xScale = chart.scales.x;
            const rect = ctx.canvas.getBoundingClientRect();
            const px = evt.clientX - rect.left;
            const xPx = Math.min(Math.max(px, xScale.left), xScale.right);
            const mi = xScale.getValueForPixel(xPx);
            const idx = kmToIndex(mi);
            const pt = pts[idx];
            if (!pt) return;
            ensureCursorMarker([pt.lat, pt.lon]).setLatLng([pt.lat, pt.lon]);
            cursorMarker.setStyle({ opacity: 1, fillOpacity: 1 });
            chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
            chart.update('none');
          };

          ctx.canvas.addEventListener('mousemove', updateFromEvent);
          ctx.canvas.addEventListener('mouseleave', () => {
            if (cursorMarker) cursorMarker.setStyle({ opacity: 0, fillOpacity: 0 });
            chart.setActiveElements([]);
            chart.update('none');
          });
          ctx.canvas.addEventListener('click', () => {
            if (!cursorMarker) return;
            const ll = cursorMarker.getLatLng();
            if (ll) map.panTo(ll, { animate: true });
          });
        } else {
          // If chart disabled, hide the card
          const card = canvas.closest('.pm-elev-card');
          if (card) card.style.display = 'none';
        }
      } else {
        // GEOJSON PATH
        let gj = geojson;
        if (!gj && geojsonUrl) {
          const res = await fetch(geojsonUrl, { cache: 'no-store' });
          if (!res.ok) throw new Error('Failed to fetch GeoJSON (' + res.status + ')');
          gj = await res.json();
        }
        if (!gj) throw new Error('Either gpxUrl or geojson/geojsonUrl is required');

        const layer = L.geoJSON(gj, {
          style: () => lineOpts
        }).addTo(map);

        try {
          map.fitBounds(layer.getBounds());
        } catch (_) {}

        addCityMarkers(map, cities);

        // Hide the elevation card (no elevation data in plain GeoJSON)
        const card = canvas.closest('.pm-elev-card');
        if (card) card.style.display = 'none';
      }
    } catch (err) {
      console.error(err);
      showError(err.message || 'Unknown error');
    }

    return { map, chart };
  }

  PMK.create = createPilgrimMap;

})(window);
