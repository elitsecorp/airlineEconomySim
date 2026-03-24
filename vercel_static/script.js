const ACTUAL_REVENUE_2023_24 = 7044875000;
const ACTUAL_EXPENSE_2023_24 = 5991117000;
const ACTUAL_OPERATING_PROFIT_2023_24 = 1053758000;
const ACTUAL_PASSENGERS_2023_24 = 17100000;
const ACTUAL_CARGO_REVENUE = 1680000000;
const ACTUAL_AIRPORT_SERVICES_REVENUE = 164000000;
const ACTUAL_HOTEL_REVENUE = 53400000;
const ACTUAL_MRO_REVENUE = 90000000;
const ACTUAL_AVIATION_UNIVERSITY_REVENUE = 8530000;
const ACTUAL_GROUND_SERVICES_REVENUE = 6100000;
const ACTUAL_PASSENGER_REVENUE = ACTUAL_REVENUE_2023_24
  - ACTUAL_CARGO_REVENUE
  - ACTUAL_AIRPORT_SERVICES_REVENUE
  - ACTUAL_HOTEL_REVENUE
  - ACTUAL_MRO_REVENUE
  - ACTUAL_AVIATION_UNIVERSITY_REVENUE
  - ACTUAL_GROUND_SERVICES_REVENUE;
const AVG_REVENUE_PER_PASSENGER = ACTUAL_REVENUE_2023_24 / ACTUAL_PASSENGERS_2023_24;
const AVG_EXPENSE_PER_PASSENGER = ACTUAL_EXPENSE_2023_24 / ACTUAL_PASSENGERS_2023_24;
const MONTHLY_HOURS_BENCHMARK = 100;
const TOTAL_PILOTS = 3000;
const PILOT_NETWORK_SCALE = 155.0;
const ADDIS_LAT = 8.9806;
const ADDIS_LON = 38.7578;

const AIRCRAFT = {
  regional: { seats: 70, fuelBurn: 1.2, crewCost: 6500, maintenancePerKm: 2.8, airportFees: 4300, avgSpeed: 650 },
  narrowbody: { seats: 160, fuelBurn: 2.8, crewCost: 11200, maintenancePerKm: 4.7, airportFees: 8800, avgSpeed: 780 },
  widebody: { seats: 300, fuelBurn: 5.4, crewCost: 18800, maintenancePerKm: 7.6, airportFees: 14500, avgSpeed: 850 },
};

const REGION_YIELD_FACTOR = {
  Domestic: 0.42,
  Africa: 0.78,
  Europe: 1.32,
  Americas: 1.55,
  "Middle East & Asia": 1.10,
};

const REGION_COST_FACTOR = {
  Domestic: 0.58,
  Africa: 0.82,
  Europe: 1.18,
  Americas: 1.28,
  "Middle East & Asia": 1.05,
};

const dom = {};
let map = null;
let routeLayerGroup = null;
let routeLayers = new Map();
let selectedRouteCode = null;
let incomeChart = null;
let revenueStructureChart = null;
let costStructureChart = null;
let routeEconomicsChart = null;
let routesData = [];
let lastState = null;

function $(id) {
  return document.getElementById(id);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function moneyBillion(value) {
  return `$${(value / 1_000_000_000).toFixed(2)}B`;
}

function fuelPassThrough(fuelPrice) {
  return 1.0 + 0.10 * (fuelPrice - 1.0);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371.0;
  const toRad = (n) => n * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeRiskReasons({ profit, revenue, loadFactor, fuelShare, frequencyFactor, active, fuelPrice, distance }) {
  const reasons = [];
  if (active) {
    if (profit < 0) reasons.push("The route is still flying, but it is losing money.");
    if (loadFactor < 0.65) reasons.push(`Demand only fills about ${(loadFactor * 100).toFixed(0)}% of seats.`);
    if (fuelShare > 0.40) reasons.push("Fuel is a large share of the route cost base.");
    if (distance > 5000) reasons.push("Long-haul flying magnifies fuel burn and crew time.");
    if (frequencyFactor < 1.0) reasons.push(`Schedule was cut to ${(frequencyFactor * 100).toFixed(0)}% of normal.`);
    if (profit > 0 && profit < 0.08 * revenue) reasons.push("Margin is thin, so a small shock could make it unsustainable.");
  } else {
    reasons.push("Fuel costs pushed the route below break-even even after schedule cuts.");
    if (loadFactor < 0.60) reasons.push("Demand is too weak to justify the capacity.");
    if (fuelPrice > 2.2) reasons.push("At this fuel price the route no longer covers its operating cost.");
  }
  return reasons.length ? reasons : ["Route remains healthy at this fuel price."];
}

function rawSimulation(fuelPrice, routes) {
  fuelPrice = clamp(Number(fuelPrice), 1.0, 3.0);
  const ticketMultiplier = fuelPassThrough(fuelPrice);

  const routeOutputs = [];
  let totalRevenue = 0;
  let totalCost = 0;
  let totalRequiredHours = 0;
  let baselineRequiredHours = 0;
  let totalPassengers = 0;
  let activeRoutes = 0;
  let atRiskRoutes = 0;
  let suspendedRoutes = 0;

  routes.forEach((spec) => {
    const aircraft = AIRCRAFT[spec.aircraft_type];
    const distance = haversineKm(ADDIS_LAT, ADDIS_LON, spec.latitude, spec.longitude);
    const ticketPrice = spec.base_ticket_price * ticketMultiplier;
    const priceRatio = ticketPrice / spec.base_ticket_price;

    const businessDemand = spec.base_demand * spec.business_share * (priceRatio ** -0.4);
    const leisureDemand = spec.base_demand * (1.0 - spec.business_share) * (priceRatio ** -1.3);
    const fuelDemandDrag = Math.max(0.55, 1.0 - 0.22 * (fuelPrice - 1.0));
    const rawDemand = (businessDemand + leisureDemand) * fuelDemandDrag;
    const capacity = spec.base_frequency * aircraft.seats;
    const passengers = Math.min(rawDemand, capacity);
    const loadFactor = capacity ? passengers / capacity : 0;

    const passengerRevenue = passengers * ticketPrice;
    const ancillaryRevenue = passengerRevenue * (0.06 + 0.01 * (distance / 7000));
    const revenue = passengerRevenue + ancillaryRevenue;

    const fuelCost = distance * aircraft.fuelBurn * fuelPrice * spec.base_frequency;
    const crewCost = aircraft.crewCost * spec.base_frequency;
    const maintenanceCost = distance * aircraft.maintenancePerKm * spec.base_frequency;
    const airportFees = aircraft.airportFees * spec.base_frequency;
    const cost = fuelCost + crewCost + maintenanceCost + airportFees;
    const profit = revenue - cost;
    const margin = revenue ? profit / revenue : 0;
    const fuelShare = cost ? fuelCost / cost : 0;

    let frequencyFactor = 1.0;
    let active = true;
    if (profit < 0) {
      atRiskRoutes += 1;
      frequencyFactor = loadFactor >= 0.60 ? 0.75 : 0.55;
      if (profit < -0.06 * revenue && fuelPrice >= 2.2) {
        active = false;
        frequencyFactor = 0.0;
        suspendedRoutes += 1;
      }
    }

    const effectiveFlights = spec.base_frequency * frequencyFactor;
    const flightHours = distance / aircraft.avgSpeed;
    const workIntensity = 0.55 + 0.45 * loadFactor;
    const currentRouteHours = effectiveFlights * flightHours * 2.0 * workIntensity * PILOT_NETWORK_SCALE;
    const baselineRouteHours = spec.base_frequency * flightHours * 2.0 * workIntensity * PILOT_NETWORK_SCALE;

    if (active) activeRoutes += 1;
    totalRequiredHours += currentRouteHours;
    baselineRequiredHours += baselineRouteHours;
    totalRevenue += revenue;
    totalCost += cost;
    totalPassengers += passengers;

    const status = !active ? "unsustainable" : profit > 0.12 * revenue ? "healthy" : "watch";
    const perFlightRevenue = passengers * (AVG_REVENUE_PER_PASSENGER * (REGION_YIELD_FACTOR[spec.region] || 1.0));
    const perFlightCost = passengers * (AVG_EXPENSE_PER_PASSENGER * (REGION_COST_FACTOR[spec.region] || 1.0)) + fuelCost / Math.max(1, effectiveFlights);
    const perFlightProfit = perFlightRevenue - perFlightCost;

    routeOutputs.push({
      ...spec,
      distance: Number(distance.toFixed(1)),
      effective_flights: Number(effectiveFlights.toFixed(2)),
      served_passengers: Math.round(passengers),
      load_factor: Number(loadFactor.toFixed(3)),
      revenue: Number(revenue.toFixed(2)),
      cost: Number(cost.toFixed(2)),
      profit: Number(profit.toFixed(2)),
      margin: Number(margin.toFixed(4)),
      fuel_share: Number(fuelShare.toFixed(3)),
      frequency_factor: Number(frequencyFactor.toFixed(2)),
      status,
      active,
      per_flight: {
        revenue: Number(perFlightRevenue.toFixed(2)),
        cost: Number(perFlightCost.toFixed(2)),
        profit: Number(perFlightProfit.toFixed(2)),
        passenger_revenue: Number((passengers * (AVG_REVENUE_PER_PASSENGER * (REGION_YIELD_FACTOR[spec.region] || 1.0))).toFixed(2)),
        ancillary_revenue: Number((passengers * (AVG_REVENUE_PER_PASSENGER * (REGION_YIELD_FACTOR[spec.region] || 1.0) * 0.08)).toFixed(2)),
        fuel_cost: Number((fuelCost / Math.max(1, effectiveFlights)).toFixed(2)),
        crew_cost: Number((crewCost / Math.max(1, effectiveFlights)).toFixed(2)),
        maintenance_cost: Number((maintenanceCost / Math.max(1, effectiveFlights)).toFixed(2)),
        airport_fees: Number((airportFees / Math.max(1, effectiveFlights)).toFixed(2)),
      },
      current_route_hours: Number(currentRouteHours.toFixed(2)),
      baseline_route_hours: Number(baselineRouteHours.toFixed(2)),
      risk_reasons: routeRiskReasons({
        profit,
        revenue,
        loadFactor,
        fuelShare,
        frequencyFactor,
        active,
        fuelPrice,
        distance,
      }),
    });
  });

  const operatingProfit = totalRevenue - totalCost;
  const hoursPerPilot = (totalRequiredHours / baselineRequiredHours) * MONTHLY_HOURS_BENCHMARK;
  const lostHoursPerPilot = Math.max(0, MONTHLY_HOURS_BENCHMARK - hoursPerPilot);
  const utilization = hoursPerPilot;
  return {
    fuel_price: Number(fuelPrice.toFixed(2)),
    summary: {
      revenue: Number(totalRevenue.toFixed(2)),
      cost: Number(totalCost.toFixed(2)),
      profit: Number(operatingProfit.toFixed(2)),
      active_routes: activeRoutes,
      at_risk_routes: atRiskRoutes,
      suspended_routes: suspendedRoutes,
      passengers: Math.round(totalPassengers),
      pilot_hours_per_pilot: Number(hoursPerPilot.toFixed(1)),
      lost_hours_per_pilot: Number(lostHoursPerPilot.toFixed(1)),
      utilization: Number(utilization.toFixed(1)),
      pilot_state: utilization < 75 ? "red" : utilization < 90 ? "yellow" : "green",
    },
    route_map: { routes: routeOutputs },
    pilot: {
      hours_per_pilot: Number(hoursPerPilot.toFixed(1)),
      lost_hours_per_pilot: Number(lostHoursPerPilot.toFixed(1)),
      utilization: Number(utilization.toFixed(1)),
      benchmark_hours: MONTHLY_HOURS_BENCHMARK,
      required_hours: Number(totalRequiredHours.toFixed(2)),
      baseline_hours: Number(baselineRequiredHours.toFixed(2)),
      state: utilization < 75 ? "red" : utilization < 90 ? "yellow" : "green",
    },
    currentTotalRequiredHours: totalRequiredHours,
    baselineTotalRequiredHours: baselineRequiredHours,
  };
}

function simulateSystem(fuelPrice, routes) {
  const raw = rawSimulation(fuelPrice, routes);
  const baselineRaw = fuelPrice === 1 ? raw : rawSimulation(1.0, routes);
  const baselineRoutesByCode = new Map(baselineRaw.route_map.routes.map((route) => [route.code, route]));
  const revenueScale = ACTUAL_REVENUE_2023_24 / raw.summary.revenue;
  const costScale = ACTUAL_EXPENSE_2023_24 / raw.summary.cost;
  const revenueMix = [
    ["Passenger transport & ancillaries", ACTUAL_PASSENGER_REVENUE],
    ["Cargo & logistics", ACTUAL_CARGO_REVENUE],
    ["Airport services", ACTUAL_AIRPORT_SERVICES_REVENUE],
    ["Hotel services", ACTUAL_HOTEL_REVENUE],
    ["Maintenance, repair & overhaul", ACTUAL_MRO_REVENUE],
    ["Aviation university", ACTUAL_AVIATION_UNIVERSITY_REVENUE],
    ["Ground services", ACTUAL_GROUND_SERVICES_REVENUE],
  ];
  const revenueValues = revenueMix.map((item) => item[1] * revenueScale);
  revenueValues[revenueValues.length - 1] = ACTUAL_REVENUE_2023_24 - revenueValues.slice(0, -1).reduce((sum, v) => sum + v, 0);

  const fuelWeight = clamp(0.34 + 0.10 * (fuelPrice - 1.0), 0.28, 0.54);
  const costMix = [
    ["Fuel, oil & energy", fuelWeight],
    ["Employee benefits", 0.20],
    ["Maintenance & reserves", 0.15],
    ["Airport, landing & handling", 0.11],
    ["Depreciation & amortization", 0.13],
    ["Leasing & finance", 0.05],
    ["Other operating costs", 0.02],
  ];
  const remainder = costMix.slice(1).reduce((sum, item) => sum + item[1], 0);
  const costValues = [ACTUAL_EXPENSE_2023_24 * costMix[0][1]];
  costValues.push(...costMix.slice(1).map((item) => ACTUAL_EXPENSE_2023_24 * (1 - costMix[0][1]) * (item[1] / remainder)));
  costValues[costValues.length - 1] = ACTUAL_EXPENSE_2023_24 - costValues.slice(0, -1).reduce((sum, v) => sum + v, 0);

  const scaledRoutes = raw.route_map.routes.map((route) => {
    const baseRoute = baselineRoutesByCode.get(route.code) || route;
    const revenue = route.revenue * revenueScale;
    const cost = route.cost * costScale;
    const profit = revenue - cost;
    const baselineFuelCost = (baseRoute.per_flight.fuel_cost || 0) * (baseRoute.effective_flights || 1);
    const breakevenFuel = baselineFuelCost > 0 ? 1 + (baseRoute.profit / baselineFuelCost) : Number.POSITIVE_INFINITY;
    const watchFuel = breakevenFuel * 0.85;
    const active = Number(fuelPrice) < breakevenFuel;
    const status = !active ? "unsustainable" : Number(fuelPrice) >= watchFuel ? "watch" : "healthy";
    const perFlightRevenue = route.per_flight.revenue * revenueScale;
    const perFlightCost = route.per_flight.cost * costScale;
    const perFlightProfit = perFlightRevenue - perFlightCost;
    return {
      ...route,
      revenue: Number(revenue.toFixed(2)),
      cost: Number(cost.toFixed(2)),
      profit: Number(profit.toFixed(2)),
      active,
      status,
      breakeven_fuel: Number.isFinite(breakevenFuel) ? Number(breakevenFuel.toFixed(2)) : null,
      per_flight: {
        ...route.per_flight,
        revenue: Number(perFlightRevenue.toFixed(2)),
        cost: Number(perFlightCost.toFixed(2)),
        profit: Number(perFlightProfit.toFixed(2)),
        passenger_revenue: Number((route.per_flight.passenger_revenue * revenueScale).toFixed(2)),
        ancillary_revenue: Number((route.per_flight.ancillary_revenue * revenueScale).toFixed(2)),
        fuel_cost: Number((route.per_flight.fuel_cost * costScale).toFixed(2)),
        crew_cost: Number((route.per_flight.crew_cost * costScale).toFixed(2)),
        maintenance_cost: Number((route.per_flight.maintenance_cost * costScale).toFixed(2)),
        airport_fees: Number((route.per_flight.airport_fees * costScale).toFixed(2)),
      },
    };
  });

  const baselineFlights = baselineRaw.route_map.routes.reduce((sum, route) => sum + (route.active ? route.effective_flights : 0), 0);
  const currentFlights = scaledRoutes.reduce((sum, route) => sum + (route.active ? route.effective_flights : 0), 0);
  const baselinePassengers = Math.max(1, baselineRaw.summary.passengers);
  const currentPassengerShare = clamp(raw.summary.passengers / baselinePassengers, 0, 1);
  const currentFlightShare = baselineFlights ? clamp(currentFlights / baselineFlights, 0, 1) : 0;
  const workloadShare = clamp(currentFlightShare * (0.6 + 0.4 * currentPassengerShare), 0, 1);
  const baselineTotalRequiredHours = TOTAL_PILOTS * MONTHLY_HOURS_BENCHMARK;
  const currentTotalRequiredHours = baselineTotalRequiredHours * workloadShare;
  const currentHoursPerPilot = workloadShare * MONTHLY_HOURS_BENCHMARK;
  const lostHoursPerPilot = Math.max(0, MONTHLY_HOURS_BENCHMARK - currentHoursPerPilot);
  const utilization = currentHoursPerPilot;
  const pilotState = utilization < 75 ? "red" : utilization < 90 ? "yellow" : "green";
  const cutRoutes = scaledRoutes.filter((route) => route.status === "unsustainable");
  const dangerRoutes = scaledRoutes.filter((route) => route.status === "watch");

  return {
    fuel_price: Number(fuelPrice.toFixed(2)),
    summary: {
      revenue: Number(ACTUAL_REVENUE_2023_24.toFixed(2)),
      cost: Number(ACTUAL_EXPENSE_2023_24.toFixed(2)),
      profit: Number(ACTUAL_OPERATING_PROFIT_2023_24.toFixed(2)),
      active_routes: scaledRoutes.filter((r) => r.active).length,
      at_risk_routes: scaledRoutes.filter((r) => r.status === "watch").length,
      suspended_routes: scaledRoutes.filter((r) => r.status === "unsustainable").length,
      passengers: raw.summary.passengers,
      pilot_hours_per_pilot: Number(currentHoursPerPilot.toFixed(1)),
      lost_hours_per_pilot: Number(lostHoursPerPilot.toFixed(1)),
      utilization: Number(utilization.toFixed(1)),
      pilot_state: pilotState,
    },
    income_statement: {
      labels: ["Revenue", "Cost", "Operating Profit"],
      values: [ACTUAL_REVENUE_2023_24, ACTUAL_EXPENSE_2023_24, ACTUAL_OPERATING_PROFIT_2023_24],
    },
    structure: {
      revenue: {
        labels: revenueMix.map((item) => item[0]),
        values: revenueValues,
        note: "Anchored to Ethiopian Airlines' published 2023/24 segment mix and scaled to the reported total revenue.",
      },
      cost: {
        labels: costMix.map((item) => item[0]),
        values: costValues,
        note: "Modeled operating cost buckets reweight fuel upward as fuel prices rise and are scaled to reported total expense.",
      },
    },
    route_map: { routes: scaledRoutes },
    pilot: {
      hours_per_pilot: Number(currentHoursPerPilot.toFixed(1)),
      lost_hours_per_pilot: Number(lostHoursPerPilot.toFixed(1)),
      utilization: Number(utilization.toFixed(1)),
      state: pilotState,
      benchmark_hours: MONTHLY_HOURS_BENCHMARK,
      required_hours: Number(currentTotalRequiredHours.toFixed(2)),
      baseline_hours: Number(baselineTotalRequiredHours.toFixed(2)),
    },
    route_lists: {
      cut: cutRoutes
        .slice()
        .sort((a, b) => a.profit - b.profit)
        .map((route) => ({
          code: route.code,
          name: route.name,
          region: route.region,
          profit: route.profit,
        })),
      danger: dangerRoutes
        .slice()
        .sort((a, b) => a.profit - b.profit)
        .map((route) => ({
          code: route.code,
          name: route.name,
          region: route.region,
          profit: route.profit,
        })),
    },
  };
}

function createIncomeChart(ctx, state) {
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: state.income_statement.labels,
      datasets: [{
        label: "USD",
        data: state.income_statement.values,
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
            label: (ctx) => money(ctx.raw),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: { callback: (value) => moneyBillion(value) },
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
              return `${money(ctx.raw)} (${percent}%)`;
            },
          },
        },
      },
    },
  });
}

function createRouteEconomicsChart(ctx) {
  return new Chart(ctx, {
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
        tooltip: { callbacks: { label: (ctx) => money(ctx.raw) } },
      },
      scales: {
        y: { ticks: { callback: (value) => moneyBillion(value) } },
      },
    },
  });
}

function clearRouteLayers() {
  if (routeLayerGroup) routeLayerGroup.clearLayers();
  routeLayers = new Map();
}

function ensureMap() {
  if (map) return;
  map = L.map(dom.routeMap, { zoomControl: true, worldCopyJump: true, scrollWheelZoom: false }).setView([15, 25], 2.2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 6,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  routeLayerGroup = L.layerGroup().addTo(map);
}

function routeBadge(route) {
  if (route.status === "unsustainable") return "inactive";
  if (route.status === "watch") return "watch";
  return "healthy";
}

function routeListItem(route, type) {
  const pill = type === "cut" ? "cut" : "watch";
  const label = type === "cut" ? "cut" : "danger";
  return `
    <button class="route-list-item" data-route="${route.code}" type="button">
      <span>
        <strong>${route.name}</strong>
        <small>${route.code} · ${route.region} · ${money(route.profit)}</small>
      </span>
      <span class="route-list-pill ${pill}">${label}</span>
    </button>
  `;
}

function renderRouteLists(state) {
  const cutRoutes = state.route_lists.cut || [];
  const dangerRoutes = state.route_lists.danger || [];
  dom.cutRoutesCount.textContent = cutRoutes.length;
  dom.dangerRoutesCount.textContent = dangerRoutes.length;

  dom.cutRoutesList.innerHTML = cutRoutes.length
    ? cutRoutes.slice(0, 12).map((route) => routeListItem(route, "cut")).join("")
    : `<div class="route-detail-empty">No routes are cut at this fuel price.</div>`;
  dom.dangerRoutesList.innerHTML = dangerRoutes.length
    ? dangerRoutes.slice(0, 12).map((route) => routeListItem(route, "danger")).join("")
    : `<div class="route-detail-empty">No routes are in danger at this fuel price.</div>`;

  dom.cutRoutesList.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = state.route_map.routes.find((item) => item.code === button.dataset.route);
      if (route) selectRoute(route);
    });
  });
  dom.dangerRoutesList.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = state.route_map.routes.find((item) => item.code === button.dataset.route);
      if (route) selectRoute(route);
    });
  });
}

function formatRouteDetail(route) {
  const riskReasons = route.risk_reasons.map((item) => `<li>${item}</li>`).join("");
  return `
    <h3>${route.name} <span class="route-code">(${route.code})</span></h3>
    <p class="route-badge ${routeBadge(route)}">${route.status}</p>
    <div class="route-kpis">
      <div><span>Distance</span><strong>${route.distance.toFixed(0)} km</strong></div>
      <div><span>Aircraft</span><strong>${route.aircraft_type}</strong></div>
      <div><span>Load factor</span><strong>${(route.load_factor * 100).toFixed(0)}%</strong></div>
      <div><span>Flights</span><strong>${route.effective_flights.toFixed(1)} / mo</strong></div>
      <div><span>Revenue</span><strong>${money(route.revenue)}</strong></div>
      <div><span>Profit</span><strong class="${route.profit >= 0 ? "positive" : "negative"}">${money(route.profit)}</strong></div>
    </div>
    <div class="route-kpis">
      <div><span>Per-flight revenue</span><strong>${money(route.per_flight.revenue)}</strong></div>
      <div><span>Per-flight cost</span><strong>${money(route.per_flight.cost)}</strong></div>
      <div><span>Per-flight profit</span><strong class="${route.per_flight.profit >= 0 ? "positive" : "negative"}">${money(route.per_flight.profit)}</strong></div>
      <div><span>Ancillary revenue</span><strong>${money(route.per_flight.ancillary_revenue)}</strong></div>
    </div>
    <div class="route-detail-copy">
      <strong>Per-flight cost mix</strong>
      <div>Fuel: ${money(route.per_flight.fuel_cost)}</div>
      <div>Crew: ${money(route.per_flight.crew_cost)}</div>
      <div>Maintenance: ${money(route.per_flight.maintenance_cost)}</div>
      <div>Airport fees: ${money(route.per_flight.airport_fees)}</div>
    </div>
    <p class="route-detail-copy">${route.active ? "This route is still operating, but its economics are under pressure." : "This route is unsustainable at the current fuel price and has been cut."}</p>
    <h4>Why it is at risk</h4>
    <ul class="risk-list">${riskReasons}</ul>
  `;
}

function updateRouteEconomicsChart(route) {
  routeEconomicsChart.data.datasets[0].data = [route.per_flight.revenue, route.per_flight.cost, route.per_flight.profit];
  routeEconomicsChart.data.datasets[0].backgroundColor = [
    "#2fbf71",
    route.status === "unsustainable" ? "#e45757" : "#f28e2b",
    route.per_flight.profit >= 0 ? "#4aa3ff" : "#e45757",
  ];
  routeEconomicsChart.update();
}

function highlightRoute(code) {
  routeLayers.forEach((layer, routeCode) => {
    const isSelected = routeCode === code;
    const style = layer.polylineOptions;
    layer.line.setStyle({ weight: isSelected ? 5 : style.weight, opacity: isSelected ? 1 : style.opacity, color: style.color });
    layer.marker.setStyle({ radius: isSelected ? 8 : 6, color: isSelected ? "#ffffff" : style.color, fillColor: style.color });
  });
}

function selectRoute(route) {
  selectedRouteCode = route.code;
  dom.routeDetail.innerHTML = formatRouteDetail(route);
  highlightRoute(route.code);
  updateRouteEconomicsChart(route);
}

function pickDefaultRoute(routes) {
  return routes.find((route) => route.code === selectedRouteCode)
    || routes.find((route) => route.status === "unsustainable")
    || routes.find((route) => route.status === "watch")
    || routes[0];
}

function renderRouteMap(routes) {
  ensureMap();
  clearRouteLayers();
  const addis = [ADDIS_LAT, ADDIS_LON];
  const bounds = [];
  routes.forEach((route) => {
    const destination = [route.latitude, route.longitude];
    const lineStyle = { color: route.status === "unsustainable" ? "#e45757" : route.status === "watch" ? "#f0b429" : "#2fbf71", weight: route.active ? 3 : 2, opacity: route.active ? 0.85 : 0.45 };
    const line = L.polyline([addis, destination], lineStyle).addTo(routeLayerGroup);
    const marker = L.circleMarker(destination, { radius: 6, color: lineStyle.color, weight: 2, fillColor: lineStyle.color, fillOpacity: 0.95 }).addTo(routeLayerGroup);
    line.on("click", () => selectRoute(route));
    marker.on("click", () => selectRoute(route));
    routeLayers.set(route.code, { line, marker, polylineOptions: lineStyle });
    bounds.push(addis, destination);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
  const selected = pickDefaultRoute(routes);
  if (selected) selectRoute(selected);
}

function updateStats(state) {
  dom.fuelValue.textContent = `${Number(state.fuel_price).toFixed(2)}x`;
  dom.revenueValue.textContent = money(state.summary.revenue);
  dom.costValue.textContent = money(state.summary.cost);
  dom.profitValue.textContent = money(state.summary.profit);
  dom.profitValue.classList.toggle("positive", state.summary.profit >= 0);
  dom.profitValue.classList.toggle("negative", state.summary.profit < 0);
  dom.routesValue.textContent = state.summary.active_routes;
  dom.pilotHoursValue.textContent = Number(state.summary.pilot_hours_per_pilot).toFixed(1);
  dom.lostHoursValue.textContent = Number(state.summary.lost_hours_per_pilot).toFixed(1);
  dom.activeRoutesValue.textContent = state.summary.active_routes;
  dom.atRiskValue.textContent = state.summary.at_risk_routes;
  dom.suspendedValue.textContent = state.summary.suspended_routes;
  dom.passengerValue.textContent = Number(state.summary.passengers).toLocaleString("en-US");
  dom.pilotUtilizationValue.textContent = `${Number(state.pilot.utilization).toFixed(1)}%`;
  dom.pilotStateValue.textContent = state.pilot.state === "red" ? "Underutilized" : state.pilot.state === "yellow" ? "Tight" : "Healthy";
  dom.hoursPerPilotValue.textContent = Number(state.pilot.hours_per_pilot).toFixed(1);
  dom.pilotLostHoursValue.textContent = Number(state.pilot.lost_hours_per_pilot).toFixed(1);
  dom.requiredHoursValue.textContent = Math.round(state.pilot.required_hours).toLocaleString("en-US");
  dom.baselineHoursValue.textContent = Math.round(state.pilot.baseline_hours).toLocaleString("en-US");
  dom.gauge.style.setProperty("--utilization", `${Math.min(state.pilot.utilization, 120)}%`);
  dom.gauge.style.setProperty("--gauge-color", state.pilot.state === "red" ? "#e45757" : state.pilot.state === "yellow" ? "#f0b429" : "#2fbf71");
}

function updateCharts(state) {
  incomeChart.data.datasets[0].data = state.income_statement.values;
  incomeChart.update();
  revenueStructureChart.data.datasets[0].data = state.structure.revenue.values;
  revenueStructureChart.update();
  costStructureChart.data.datasets[0].data = state.structure.cost.values;
  costStructureChart.update();
  dom.revenueStructureNote.textContent = state.structure.revenue.note;
  dom.costStructureNote.textContent = state.structure.cost.note;
}

function updateDashboard(state) {
  updateStats(state);
  updateCharts(state);
  renderRouteMap(state.route_map.routes);
  renderRouteLists(state);
}

function initCharts(state) {
  incomeChart = createIncomeChart(dom.incomeChart, state);
  revenueStructureChart = createStructureChart(dom.revenueStructureChart, state.structure.revenue.labels, state.structure.revenue.values, ["#4aa3ff", "#2fbf71", "#f0b429", "#e45757", "#b78cff", "#7dd3fc", "#94a3b8"]);
  costStructureChart = createStructureChart(dom.costStructureChart, state.structure.cost.labels, state.structure.cost.values, ["#e45757", "#f28e2b", "#f0b429", "#4aa3ff", "#8b5cf6", "#2fbf71", "#94a3b8"]);
  routeEconomicsChart = createRouteEconomicsChart(dom.routeEconomicsChart);
}

function initDom() {
  [
    "fuelSlider", "fuelValue", "revenueValue", "costValue", "profitValue", "routesValue",
    "pilotHoursValue", "lostHoursValue", "activeRoutesValue", "atRiskValue", "suspendedValue",
    "passengerValue", "revenueStructureNote", "costStructureNote", "pilotUtilizationValue",
    "pilotStateValue", "hoursPerPilotValue", "pilotLostHoursValue", "requiredHoursValue",
    "baselineHoursValue", "gauge", "routeDetail", "routeMap", "incomeChart",
    "revenueStructureChart", "costStructureChart", "routeEconomicsChart",
    "cutRoutesCount", "dangerRoutesCount", "cutRoutesList", "dangerRoutesList",
  ].forEach((key) => {
    dom[key] = $(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
  });
  dom.fuelSlider = $("fuel-slider");
  dom.fuelValue = $("fuel-value");
  dom.revenueValue = $("revenue-value");
  dom.costValue = $("cost-value");
  dom.profitValue = $("profit-value");
  dom.routesValue = $("routes-value");
  dom.pilotHoursValue = $("pilot-hours-value");
  dom.lostHoursValue = $("lost-hours-value");
  dom.activeRoutesValue = $("active-routes-value");
  dom.atRiskValue = $("at-risk-value");
  dom.suspendedValue = $("suspended-value");
  dom.passengerValue = $("passenger-value");
  dom.revenueStructureNote = $("revenue-structure-note");
  dom.costStructureNote = $("cost-structure-note");
  dom.pilotUtilizationValue = $("pilot-utilization");
  dom.pilotStateValue = $("pilot-state");
  dom.hoursPerPilotValue = $("hours-per-pilot");
  dom.pilotLostHoursValue = $("pilot-lost-hours");
  dom.requiredHoursValue = $("required-hours");
  dom.baselineHoursValue = $("baseline-hours");
  dom.gauge = $("gauge");
  dom.routeDetail = $("route-detail");
  dom.routeMap = $("route-map");
  dom.incomeChart = $("income-chart");
  dom.revenueStructureChart = $("revenue-structure-chart");
  dom.costStructureChart = $("cost-structure-chart");
  dom.routeEconomicsChart = $("route-economics-chart");
  dom.cutRoutesCount = $("cut-routes-count");
  dom.dangerRoutesCount = $("danger-routes-count");
  dom.cutRoutesList = $("cut-routes-list");
  dom.dangerRoutesList = $("danger-routes-list");
}

async function main() {
  initDom();
  const response = await fetch("./routes.json");
  routesData = await response.json();
  const initialState = simulateSystem(1.0, routesData);
  initCharts(initialState);
  updateDashboard(initialState);

  let debounceTimer = null;
  dom.fuelSlider.addEventListener("input", () => {
    const fuelPrice = dom.fuelSlider.value;
    dom.fuelValue.textContent = `${Number(fuelPrice).toFixed(2)}x`;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const state = simulateSystem(Number(fuelPrice), routesData);
      lastState = state;
      updateDashboard(state);
    }, 90);
  });
}

main().catch((error) => {
  console.error(error);
  const message = document.createElement("div");
  message.style.cssText = "padding:24px;color:#fff;font-family:system-ui";
  message.textContent = "Failed to load the static dashboard. Check that routes.json is present.";
  document.body.prepend(message);
});
