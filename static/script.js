const initialState = window.__INITIAL_STATE__;

const fuelSlider = document.getElementById("fuel-slider");
const fuelValue = document.getElementById("fuel-value");
const revenueValue = document.getElementById("revenue-value");
const costValue = document.getElementById("cost-value");
const profitValue = document.getElementById("profit-value");
const routesValue = document.getElementById("routes-value");
const pilotHoursValue = document.getElementById("pilot-hours-value");
const lostHoursValue = document.getElementById("lost-hours-value");
const activeRoutesValue = document.getElementById("active-routes-value");
const atRiskValue = document.getElementById("at-risk-value");
const suspendedValue = document.getElementById("suspended-value");
const passengerValue = document.getElementById("passenger-value");
const revenueStructureNote = document.getElementById("revenue-structure-note");
const costStructureNote = document.getElementById("cost-structure-note");
const pilotUtilizationValue = document.getElementById("pilot-utilization");
const pilotStateValue = document.getElementById("pilot-state");
const hoursPerPilotValue = document.getElementById("hours-per-pilot");
const pilotLostHoursValue = document.getElementById("pilot-lost-hours");
const requiredHoursValue = document.getElementById("required-hours");
const baselineHoursValue = document.getElementById("baseline-hours");
const gauge = document.getElementById("gauge");
const routeDetail = document.getElementById("route-detail");
const routeMapNode = document.getElementById("route-map");

const incomeCtx = document.getElementById("income-chart");
const revenueStructureCtx = document.getElementById("revenue-structure-chart");
const costStructureCtx = document.getElementById("cost-structure-chart");
const routeEconomicsCtx = document.getElementById("route-economics-chart");

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

let map = null;
let routeLayerGroup = null;
let routeLayers = new Map();
let selectedRouteCode = null;

function moneyBillion(value) {
  return `$${(value / 1_000_000_000).toFixed(2)}B`;
}

function colorForStatus(status) {
  if (status === "unsustainable") return "#e45757";
  if (status === "watch") return "#f0b429";
  return "#2fbf71";
}

function colorForPilot(utilization) {
  if (utilization < 75) return "#e45757";
  if (utilization < 90) return "#f0b429";
  return "#2fbf71";
}

function stateLabel(utilization) {
  if (utilization < 75) return "Underutilized";
  if (utilization < 90) return "Tight";
  return "Healthy";
}

function createIncomeChart() {
  return new Chart(incomeCtx, {
    type: "bar",
    data: {
      labels: initialState.income_statement.labels,
      datasets: [{
        label: "USD",
        data: initialState.income_statement.values,
        backgroundColor: ["#2fbf71", "#f28e2b", "#2fbf71"],
        borderRadius: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => moneyFormatter.format(ctx.raw),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: (value) => moneyBillion(value),
          },
        },
      },
    },
  });
}

function createStructureChart(ctx, labels, values, colors) {
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: "rgba(255,255,255,0.06)",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#ecf3fb",
            boxWidth: 12,
            padding: 16,
            generateLabels(chart) {
              const data = chart.data.datasets[0].data;
              const total = data.reduce((sum, value) => sum + value, 0);
              return chart.data.labels.map((label, index) => {
                const value = data[index];
                const percent = total ? ((value / total) * 100).toFixed(1) : "0.0";
                return {
                  text: `${label} (${percent}%)`,
                  fillStyle: chart.data.datasets[0].backgroundColor[index],
                  strokeStyle: chart.data.datasets[0].backgroundColor[index],
                  lineWidth: 0,
                  hidden: false,
                  index,
                };
              });
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
              const percent = total ? ((ctx.raw / total) * 100).toFixed(1) : "0.0";
              return `${moneyFormatter.format(ctx.raw)} (${percent}%)`;
            },
          },
        },
      },
    },
  });
}

function createRouteEconomicsChart() {
  return new Chart(routeEconomicsCtx, {
    type: "bar",
    data: {
      labels: ["Revenue / flight", "Cost / flight", "Profit / flight"],
      datasets: [{
        label: "USD",
        data: [0, 0, 0],
        backgroundColor: ["#2fbf71", "#f28e2b", "#4aa3ff"],
        borderRadius: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
              const percent = total ? ((ctx.raw / total) * 100).toFixed(1) : "0.0";
              return `${moneyFormatter.format(ctx.raw)} (${percent}%)`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => moneyBillion(value),
          },
        },
      },
    },
  });
}

const incomeChart = createIncomeChart();
const revenueStructureChart = createStructureChart(
  revenueStructureCtx,
  initialState.structure.revenue.labels,
  initialState.structure.revenue.values,
  ["#4aa3ff", "#2fbf71", "#f0b429", "#e45757", "#b78cff", "#7dd3fc", "#94a3b8"]
);
const costStructureChart = createStructureChart(
  costStructureCtx,
  initialState.structure.cost.labels,
  initialState.structure.cost.values,
  ["#e45757", "#f28e2b", "#f0b429", "#4aa3ff", "#8b5cf6", "#2fbf71", "#94a3b8"]
);
const routeEconomicsChart = createRouteEconomicsChart();

function clearRouteLayers() {
  if (routeLayerGroup) {
    routeLayerGroup.clearLayers();
  }
  routeLayers = new Map();
}

function ensureMap() {
  if (map) return;

  map = L.map(routeMapNode, {
    zoomControl: true,
    worldCopyJump: true,
    scrollWheelZoom: false,
  }).setView([15, 25], 2.2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 6,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  routeLayerGroup = L.layerGroup().addTo(map);
}

function highlightRoute(code) {
  routeLayers.forEach((layer, routeCode) => {
    const isSelected = routeCode === code;
    const style = layer.polylineOptions;
    layer.line.setStyle({
      weight: isSelected ? 5 : style.weight,
      opacity: isSelected ? 1 : style.opacity,
      color: style.color,
    });
    layer.marker.setStyle({
      radius: isSelected ? 8 : 6,
      color: isSelected ? "#ffffff" : style.color,
      fillColor: style.color,
    });
  });
}

function routeBadge(route) {
  if (route.status === "unsustainable") return "inactive";
  if (route.status === "watch") return "watch";
  return "healthy";
}

function formatRouteDetail(route) {
  const riskReasons = route.risk_reasons.map((item) => `<li>${item}</li>`).join("");
  const perFlight = route.per_flight;

  return `
    <h3>${route.name} <span class="route-code">(${route.code})</span></h3>
    <p class="route-badge ${routeBadge(route)}">${route.status}</p>
    <div class="route-kpis">
      <div><span>Distance</span><strong>${route.distance.toFixed(0)} km</strong></div>
      <div><span>Aircraft</span><strong>${route.aircraft_type}</strong></div>
      <div><span>Load factor</span><strong>${(route.load_factor * 100).toFixed(0)}%</strong></div>
      <div><span>Flights</span><strong>${route.effective_flights.toFixed(1)} / mo</strong></div>
      <div><span>Revenue</span><strong>${moneyFormatter.format(route.revenue)}</strong></div>
      <div><span>Profit</span><strong class="${route.profit >= 0 ? "positive" : "negative"}">${moneyFormatter.format(route.profit)}</strong></div>
    </div>
    <div class="route-kpis">
      <div><span>Per-flight revenue</span><strong>${moneyFormatter.format(perFlight.revenue)}</strong></div>
      <div><span>Per-flight cost</span><strong>${moneyFormatter.format(perFlight.cost)}</strong></div>
      <div><span>Per-flight profit</span><strong class="${perFlight.profit >= 0 ? "positive" : "negative"}">${moneyFormatter.format(perFlight.profit)}</strong></div>
      <div><span>Ancillary revenue</span><strong>${moneyFormatter.format(perFlight.ancillary_revenue)}</strong></div>
    </div>
    <div class="route-detail-copy">
      <strong>Per-flight cost mix</strong>
      <div>Fuel: ${moneyFormatter.format(perFlight.fuel_cost)}</div>
      <div>Crew: ${moneyFormatter.format(perFlight.crew_cost)}</div>
      <div>Maintenance: ${moneyFormatter.format(perFlight.maintenance_cost)}</div>
      <div>Airport fees: ${moneyFormatter.format(perFlight.airport_fees)}</div>
    </div>
    <p class="route-detail-copy">
      ${route.active ? "This route is still operating, but its economics are under pressure." : "This route is unsustainable at the current fuel price and has been cut."}
    </p>
    <h4>Why it is at risk</h4>
    <ul class="risk-list">${riskReasons}</ul>
  `;
}

function updateRouteEconomicsChart(route) {
  routeEconomicsChart.data.datasets[0].data = [
    route.per_flight.revenue,
    route.per_flight.cost,
    route.per_flight.profit,
  ];
  routeEconomicsChart.data.datasets[0].backgroundColor = [
    "#2fbf71",
    route.status === "unsustainable" ? "#e45757" : "#f28e2b",
    route.per_flight.profit >= 0 ? "#4aa3ff" : "#e45757",
  ];
  routeEconomicsChart.update();
}

function selectRoute(route) {
  selectedRouteCode = route.code;
  routeDetail.innerHTML = formatRouteDetail(route);
  highlightRoute(route.code);
  updateRouteEconomicsChart(route);
}

function pickDefaultRoute(routes) {
  return routes.find((route) => route.code === selectedRouteCode) ||
    routes.find((route) => route.status === "unsustainable") ||
    routes.find((route) => route.status === "watch") ||
    routes[0];
}

function renderRouteMap(routes) {
  ensureMap();
  clearRouteLayers();

  const addis = [8.9806, 38.7578];
  const routeBounds = [];

  routes.forEach((route) => {
    const destination = [route.latitude, route.longitude];
    const lineStyle = {
      color: colorForStatus(route.status),
      weight: route.active ? 3 : 2,
      opacity: route.active ? 0.85 : 0.45,
    };

    const line = L.polyline([addis, destination], lineStyle).addTo(routeLayerGroup);
    const marker = L.circleMarker(destination, {
      radius: 6,
      color: lineStyle.color,
      weight: 2,
      fillColor: lineStyle.color,
      fillOpacity: 0.95,
    }).addTo(routeLayerGroup);

    line.on("click", () => selectRoute(route));
    marker.on("click", () => selectRoute(route));

    routeLayers.set(route.code, {
      line,
      marker,
      polylineOptions: lineStyle,
    });

    routeBounds.push(addis, destination);
  });

  if (routeBounds.length) {
    map.fitBounds(routeBounds, { padding: [24, 24] });
  }

  const selected = pickDefaultRoute(routes);
  if (selected) {
    selectRoute(selected);
  }
}

function updateStats(data) {
  fuelValue.textContent = `${Number(data.fuel_price).toFixed(2)}x`;
  revenueValue.textContent = moneyFormatter.format(data.summary.revenue);
  costValue.textContent = moneyFormatter.format(data.summary.cost);
  profitValue.textContent = moneyFormatter.format(data.summary.profit);
  profitValue.classList.toggle("positive", data.summary.profit >= 0);
  profitValue.classList.toggle("negative", data.summary.profit < 0);
  routesValue.textContent = data.summary.active_routes;

  pilotHoursValue.textContent = Number(data.summary.pilot_hours_per_pilot).toFixed(1);
  lostHoursValue.textContent = Number(data.summary.lost_hours_per_pilot).toFixed(1);
  activeRoutesValue.textContent = data.summary.active_routes;
  atRiskValue.textContent = data.summary.at_risk_routes;
  suspendedValue.textContent = data.summary.suspended_routes;
  passengerValue.textContent = Math.round(data.summary.passengers).toLocaleString("en-US");

  pilotUtilizationValue.textContent = `${Number(data.pilot.utilization).toFixed(1)}%`;
  pilotStateValue.textContent = stateLabel(data.pilot.utilization);
  hoursPerPilotValue.textContent = Number(data.pilot.hours_per_pilot).toFixed(1);
  pilotLostHoursValue.textContent = Number(data.pilot.lost_hours_per_pilot).toFixed(1);
  requiredHoursValue.textContent = Math.round(data.pilot.required_hours).toLocaleString("en-US");
  baselineHoursValue.textContent = Math.round(data.pilot.baseline_hours).toLocaleString("en-US");

  gauge.style.setProperty("--utilization", `${Math.min(data.pilot.utilization, 120)}%`);
  gauge.style.setProperty("--gauge-color", colorForPilot(Number(data.pilot.utilization)));
}

function updateCharts(data) {
  incomeChart.data.datasets[0].data = data.income_statement.values;
  incomeChart.update();

  revenueStructureChart.data.datasets[0].data = data.structure.revenue.values;
  revenueStructureChart.update();

  costStructureChart.data.datasets[0].data = data.structure.cost.values;
  costStructureChart.update();

  revenueStructureNote.textContent = data.structure.revenue.note;
  costStructureNote.textContent = data.structure.cost.note;
}

function updateDashboard(data) {
  updateStats(data);
  updateCharts(data);
  renderRouteMap(data.route_map.routes);
}

async function refreshDashboard(fuelPrice) {
  const response = await fetch(`/api/simulate?fuel_price=${encodeURIComponent(fuelPrice)}`);
  if (!response.ok) {
    throw new Error("Unable to refresh simulation");
  }
  return response.json();
}

let debounceTimer = null;
fuelSlider.addEventListener("input", () => {
  const fuelPrice = fuelSlider.value;
  fuelValue.textContent = `${Number(fuelPrice).toFixed(2)}x`;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const data = await refreshDashboard(fuelPrice);
      updateDashboard(data);
    } catch (error) {
      console.error(error);
    }
  }, 90);
});

updateDashboard(initialState);
