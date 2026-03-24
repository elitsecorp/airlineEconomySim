from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, List, Tuple

from flask import Flask, jsonify, render_template, request


app = Flask(__name__)


ADDIS_LAT = 8.9806
ADDIS_LON = 38.7578

TOTAL_PILOTS = 3000
MONTHLY_HOURS_BENCHMARK = 100.0

ACTUAL_REVENUE_2023_24 = 7_044_875_000
ACTUAL_EXPENSE_2023_24 = 5_991_117_000
ACTUAL_OPERATING_PROFIT_2023_24 = 1_053_758_000
ACTUAL_PASSENGERS_2023_24 = 17_100_000
ACTUAL_CARGO_REVENUE = 1_680_000_000
ACTUAL_AIRPORT_SERVICES_REVENUE = 164_000_000
ACTUAL_HOTEL_REVENUE = 53_400_000
ACTUAL_MRO_REVENUE = 90_000_000
ACTUAL_AVIATION_UNIVERSITY_REVENUE = 8_530_000
ACTUAL_GROUND_SERVICES_REVENUE = 6_100_000
ACTUAL_PASSENGER_REVENUE = (
    ACTUAL_REVENUE_2023_24
    - ACTUAL_CARGO_REVENUE
    - ACTUAL_AIRPORT_SERVICES_REVENUE
    - ACTUAL_HOTEL_REVENUE
    - ACTUAL_MRO_REVENUE
    - ACTUAL_AVIATION_UNIVERSITY_REVENUE
    - ACTUAL_GROUND_SERVICES_REVENUE
)
AVG_REVENUE_PER_PASSENGER = ACTUAL_REVENUE_2023_24 / ACTUAL_PASSENGERS_2023_24
AVG_EXPENSE_PER_PASSENGER = ACTUAL_EXPENSE_2023_24 / ACTUAL_PASSENGERS_2023_24

REGION_YIELD_FACTOR = {
    "Domestic": 0.42,
    "Africa": 0.78,
    "Europe": 1.32,
    "Americas": 1.55,
    "Middle East & Asia": 1.10,
}

REGION_COST_FACTOR = {
    "Domestic": 0.58,
    "Africa": 0.82,
    "Europe": 1.18,
    "Americas": 1.28,
    "Middle East & Asia": 1.05,
}


AIRCRAFT = {
    "regional": {
        "seats": 70,
        "fuel_burn": 1.2,
        "crew_cost": 6_500,
        "maintenance_per_km": 2.8,
        "airport_fees": 4_300,
        "avg_speed": 650,
    },
    "narrowbody": {
        "seats": 160,
        "fuel_burn": 2.8,
        "crew_cost": 11_200,
        "maintenance_per_km": 4.7,
        "airport_fees": 8_800,
        "avg_speed": 780,
    },
    "widebody": {
        "seats": 300,
        "fuel_burn": 5.4,
        "crew_cost": 18_800,
        "maintenance_per_km": 7.6,
        "airport_fees": 14_500,
        "avg_speed": 850,
    },
}


@dataclass(frozen=True)
class Route:
    code: str
    name: str
    region: str
    latitude: float
    longitude: float
    aircraft_type: str
    base_demand: int
    base_ticket_price: int
    business_share: float
    base_frequency: float


def slugify(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", name.upper()).strip("-")
    return cleaned[:8] or "ROUTE"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def fuel_pass_through(fuel_price: float) -> float:
    return 1.0 + 0.10 * (fuel_price - 1.0)


DESTINATIONS: List[Tuple[str, str, float, float]] = [
    ("Arba Minch", "Domestic", 6.0333, 37.5500),
    ("Assosa", "Domestic", 10.0667, 34.5333),
    ("Axum", "Domestic", 14.1200, 38.7300),
    ("Bahir Dar", "Domestic", 11.6000, 37.3833),
    ("Bale Robe", "Domestic", 7.1170, 39.6300),
    ("Dembidollo", "Domestic", 8.5300, 34.8000),
    ("Dire Dawa", "Domestic", 9.6000, 41.8500),
    ("Gambella", "Domestic", 8.2500, 34.5800),
    ("Gode", "Domestic", 5.9500, 43.4500),
    ("Gondar", "Domestic", 12.6000, 37.4700),
    ("Hawassa", "Domestic", 7.0500, 38.4800),
    ("Humera", "Domestic", 14.3100, 36.6200),
    ("Jijiga", "Domestic", 9.3500, 42.8000),
    ("Jimma", "Domestic", 7.6700, 36.8300),
    ("Jinka", "Domestic", 5.7900, 36.5600),
    ("Kabri Dar", "Domestic", 6.7400, 44.2700),
    ("Kombolcha", "Domestic", 11.0900, 39.7400),
    ("Lalibela", "Domestic", 12.0300, 39.0500),
    ("Mekelle", "Domestic", 13.4900, 39.4700),
    ("Semera", "Domestic", 11.7900, 40.9900),
    ("Shire", "Domestic", 14.1000, 38.2800),
    ("Abidjan", "Africa", 5.3600, -4.0100),
    ("Abuja", "Africa", 9.0600, 7.4900),
    ("Accra", "Africa", 5.6037, -0.1870),
    ("Antananarivo", "Africa", -18.8792, 47.5079),
    ("Asmara", "Africa", 15.3229, 38.9251),
    ("Bamako", "Africa", 12.6392, -8.0029),
    ("Blantyre", "Africa", -15.7861, 35.0058),
    ("Brazzaville", "Africa", -4.2634, 15.2429),
    ("Bujumbura", "Africa", -3.3614, 29.3599),
    ("Bulawayo", "Africa", -20.1325, 28.6265),
    ("Bosaso", "Africa", 11.2833, 49.1833),
    ("Cairo", "Africa", 30.0444, 31.2357),
    ("Cape Town", "Africa", -33.9249, 18.4241),
    ("Comoros", "Africa", -11.7172, 43.2473),
    ("Conakry", "Africa", 9.6412, -13.5784),
    ("Cotonou", "Africa", 6.3703, 2.3912),
    ("Dakar", "Africa", 14.7167, -17.4677),
    ("Dar es Salaam", "Africa", -6.7924, 39.2083),
    ("Djibouti", "Africa", 11.5890, 43.1480),
    ("Douala", "Africa", 4.0511, 9.7679),
    ("Entebbe", "Africa", 0.3476, 32.5825),
    ("Enugu", "Africa", 6.4528, 7.5103),
    ("Gaborone", "Africa", -24.6282, 25.9231),
    ("Garowe", "Africa", 8.4050, 48.4820),
    ("Goma", "Africa", -1.6800, 29.2200),
    ("Harare", "Africa", -17.8252, 31.0335),
    ("Hargeisa", "Africa", 9.5625, 44.0770),
    ("Johannesburg", "Africa", -26.2041, 28.0473),
    ("Juba", "Africa", 4.8594, 31.5713),
    ("Kano", "Africa", 12.0022, 8.5919),
    ("Khartoum", "Africa", 15.5007, 32.5599),
    ("Kigali", "Africa", -1.9579, 30.1127),
    ("Kilimanjaro", "Africa", -3.3650, 37.3500),
    ("Kinshasa", "Africa", -4.4419, 15.2663),
    ("Lagos", "Africa", 6.5244, 3.3792),
    ("Libreville", "Africa", 0.3901, 9.4544),
    ("Lilongwe", "Africa", -13.9626, 33.7741),
    ("Lome", "Africa", 6.1725, 1.2314),
    ("Luanda", "Africa", -8.8390, 13.2894),
    ("Lubumbashi", "Africa", -11.6609, 27.4794),
    ("Lusaka", "Africa", -15.3875, 28.3228),
    ("Malabo", "Africa", 3.7450, 8.7741),
    ("Maputo", "Africa", -25.9692, 32.5732),
    ("Mombasa", "Africa", -4.0435, 39.6682),
    ("Mogadishu", "Africa", 2.0469, 45.3182),
    ("N'Djamena", "Africa", 12.1348, 15.0557),
    ("Nairobi", "Africa", -1.2864, 36.8172),
    ("Niamey", "Africa", 13.5116, 2.1254),
    ("Ouagadougou", "Africa", 12.3714, -1.5197),
    ("Pointe-Noire", "Africa", -4.7690, 11.8650),
    ("Seychelles", "Africa", -4.6210, 55.4550),
    ("Victoria Falls", "Africa", -17.9318, 25.8300),
    ("Windhoek", "Africa", -22.5609, 17.0658),
    ("Yaounde", "Africa", 3.8480, 11.5021),
    ("Zanzibar", "Africa", -6.1659, 39.2026),
    ("Atlanta", "Americas", 33.6407, -84.4277),
    ("Buenos Aires", "Americas", -34.6037, -58.3816),
    ("Chicago", "Americas", 41.9742, -87.9073),
    ("Newark", "Americas", 40.6895, -74.1745),
    ("New York", "Americas", 40.6413, -73.7781),
    ("Sao Paulo", "Americas", -23.5505, -46.6333),
    ("Toronto", "Americas", 43.6777, -79.6248),
    ("Washington DC", "Americas", 38.8512, -77.0402),
    ("Athens", "Europe", 37.9838, 23.7275),
    ("Brussels", "Europe", 50.8503, 4.3517),
    ("Copenhagen", "Europe", 55.6761, 12.5683),
    ("Dublin", "Europe", 53.3498, -6.2603),
    ("Frankfurt", "Europe", 50.1109, 8.6821),
    ("Geneva", "Europe", 46.2044, 6.1432),
    ("Istanbul", "Europe", 41.0082, 28.9784),
    ("London", "Europe", 51.4700, -0.4543),
    ("Manchester", "Europe", 53.3650, -2.2725),
    ("Marseille", "Europe", 43.2970, 5.3811),
    ("Milan", "Europe", 45.6300, 8.7230),
    ("Moscow", "Europe", 55.9726, 37.4146),
    ("Oslo", "Europe", 60.1939, 11.1004),
    ("Paris", "Europe", 49.0097, 2.5479),
    ("Rome", "Europe", 41.7999, 12.2462),
    ("Stockholm", "Europe", 59.6519, 17.9186),
    ("Vienna", "Europe", 48.1103, 16.5697),
    ("Zurich", "Europe", 47.4647, 8.5492),
    ("Amman", "Middle East & Asia", 31.7226, 35.9932),
    ("Bahrain", "Middle East & Asia", 26.2708, 50.6336),
    ("Bangalore", "Middle East & Asia", 12.9716, 77.5946),
    ("Bangkok", "Middle East & Asia", 13.6900, 100.7501),
    ("Beijing", "Middle East & Asia", 39.5098, 116.4107),
    ("Beirut", "Middle East & Asia", 33.8209, 35.4884),
    ("Chengdu", "Middle East & Asia", 30.5785, 103.9490),
    ("Chennai", "Middle East & Asia", 12.9900, 80.1700),
    ("Dammam", "Middle East & Asia", 26.4712, 49.7978),
    ("Delhi", "Middle East & Asia", 28.5562, 77.1000),
    ("Doha", "Middle East & Asia", 25.2730, 51.6080),
    ("Dubai", "Middle East & Asia", 25.2528, 55.3644),
    ("Guangzhou", "Middle East & Asia", 23.3924, 113.2988),
    ("Hong Kong", "Middle East & Asia", 22.3080, 113.9185),
    ("Jakarta", "Middle East & Asia", -6.1256, 106.6559),
    ("Jeddah", "Middle East & Asia", 21.6702, 39.1565),
    ("Karachi", "Middle East & Asia", 24.9065, 67.1608),
    ("Kuala Lumpur", "Middle East & Asia", 2.7456, 101.7072),
    ("Kuwait", "Middle East & Asia", 29.2260, 47.9689),
    ("Manila", "Middle East & Asia", 14.5086, 121.0198),
    ("Mumbai", "Middle East & Asia", 19.0896, 72.8656),
    ("Muscat", "Middle East & Asia", 23.5933, 58.2844),
    ("Riyadh", "Middle East & Asia", 24.9576, 46.6988),
    ("Seoul", "Middle East & Asia", 37.4602, 126.4407),
    ("Shanghai", "Middle East & Asia", 31.1940, 121.3365),
    ("Singapore", "Middle East & Asia", 1.3644, 103.9915),
    ("Tel Aviv", "Middle East & Asia", 32.0114, 34.8867),
    ("Tokyo", "Middle East & Asia", 35.5494, 139.7798),
]


def route_defaults(region: str, distance: float) -> Tuple[str, int, int, float, float]:
    if region == "Domestic":
        aircraft_type = "regional" if distance < 1100 else "narrowbody" if distance < 1800 else "regional"
        base_demand = int(max(1400, 3800 - distance * 0.65))
        base_ticket_price = int(max(120, 95 + distance * 0.22))
        business_share = 0.28
        base_frequency = max(4.0, round(9 - distance / 900, 1))
    elif region == "Africa":
        aircraft_type = "regional" if distance < 900 else "narrowbody" if distance < 3000 else "widebody"
        base_demand = int(max(2200, 10000 - distance * 1.1))
        base_ticket_price = int(max(180, 140 + distance * 0.13))
        business_share = 0.48
        base_frequency = max(3.0, round(10 - distance / 1200, 1))
    elif region == "Europe":
        aircraft_type = "widebody"
        base_demand = int(max(4200, 11000 - distance * 0.45))
        base_ticket_price = int(max(620, 260 + distance * 0.09))
        business_share = 0.63
        base_frequency = max(3.0, round(7 - distance / 2200, 1))
    elif region == "Americas":
        aircraft_type = "widebody"
        base_demand = int(max(4800, 12000 - distance * 0.40))
        base_ticket_price = int(max(780, 330 + distance * 0.08))
        business_share = 0.68
        base_frequency = max(2.0, round(5 - distance / 5000, 1))
    else:
        aircraft_type = "widebody" if distance > 2600 else "narrowbody"
        base_demand = int(max(4500, 11500 - distance * 0.38))
        base_ticket_price = int(max(700, 280 + distance * 0.09))
        business_share = 0.60
        base_frequency = max(2.0, round(6 - distance / 4000, 1))

    return aircraft_type, base_demand, base_ticket_price, business_share, base_frequency


def build_routes() -> List[Route]:
    routes: List[Route] = []
    for name, region, lat, lon in DESTINATIONS:
        distance = haversine_km(ADDIS_LAT, ADDIS_LON, lat, lon)
        aircraft_type, base_demand, base_ticket_price, business_share, base_frequency = route_defaults(region, distance)
        routes.append(
            Route(
                code=slugify(name),
                name=name,
                region=region,
                latitude=lat,
                longitude=lon,
                aircraft_type=aircraft_type,
                base_demand=base_demand,
                base_ticket_price=base_ticket_price,
                business_share=business_share,
                base_frequency=base_frequency,
            )
        )
    return routes


ROUTES = build_routes()
ROUTES_BY_CODE = {route.code: route for route in ROUTES}


def route_risk_reasons(
    *,
    profit: float,
    revenue: float,
    load_factor: float,
    fuel_share: float,
    frequency_factor: float,
    active: bool,
    fuel_price: float,
    distance: float,
) -> List[str]:
    reasons: List[str] = []
    if active:
        if profit < 0:
            reasons.append("The route is still flying, but it is losing money.")
        if load_factor < 0.65:
            reasons.append(f"Demand only fills about {load_factor * 100:.0f}% of seats.")
        if fuel_share > 0.40:
            reasons.append("Fuel is a large share of the route cost base.")
        if distance > 5000:
            reasons.append("Long-haul flying magnifies fuel burn and crew time.")
        if frequency_factor < 1.0:
            reasons.append(f"Schedule was cut to {int(frequency_factor * 100)}% of normal.")
        if profit > 0 and profit < 0.08 * revenue:
            reasons.append("Margin is thin, so a small shock could make it unsustainable.")
    else:
        reasons.append("Fuel costs pushed the route below break-even even after schedule cuts.")
        if load_factor < 0.60:
            reasons.append("Demand is too weak to justify the capacity.")
        if fuel_price > 2.2:
            reasons.append("At this fuel price the route no longer covers its operating cost.")
    return reasons or ["Route remains healthy at this fuel price."]


def _raw_simulation(fuel_price: float) -> Dict:
    fuel_price = clamp(float(fuel_price), 1.0, 3.0)
    ticket_multiplier = fuel_pass_through(fuel_price)

    route_outputs = []
    total_revenue = 0.0
    total_cost = 0.0
    total_required_hours = 0.0
    baseline_required_hours = 0.0
    total_passengers = 0.0
    active_routes = 0
    at_risk_routes = 0
    suspended_routes = 0

    for spec in ROUTES:
        aircraft = AIRCRAFT[spec.aircraft_type]
        distance = haversine_km(ADDIS_LAT, ADDIS_LON, spec.latitude, spec.longitude)
        ticket_price = spec.base_ticket_price * ticket_multiplier
        price_ratio = ticket_price / spec.base_ticket_price

        business_demand = spec.base_demand * spec.business_share * (price_ratio ** -0.4)
        leisure_demand = spec.base_demand * (1.0 - spec.business_share) * (price_ratio ** -1.3)
        fuel_demand_drag = max(0.55, 1.0 - 0.22 * (fuel_price - 1.0))
        raw_demand = (business_demand + leisure_demand) * fuel_demand_drag
        capacity = spec.base_frequency * aircraft["seats"]
        passengers = min(raw_demand, capacity)
        load_factor = passengers / capacity if capacity else 0.0

        passenger_revenue = passengers * ticket_price
        ancillary_revenue = passenger_revenue * (0.06 + 0.01 * (distance / 7000.0))
        revenue = passenger_revenue + ancillary_revenue

        fuel_cost = distance * aircraft["fuel_burn"] * fuel_price * spec.base_frequency
        crew_cost = aircraft["crew_cost"] * spec.base_frequency
        maintenance_cost = distance * aircraft["maintenance_per_km"] * spec.base_frequency
        airport_fees = aircraft["airport_fees"] * spec.base_frequency
        cost = fuel_cost + crew_cost + maintenance_cost + airport_fees
        profit = revenue - cost
        margin = profit / revenue if revenue else 0.0
        fuel_share = fuel_cost / cost if cost else 0.0

        frequency_factor = 1.0
        active = True
        if profit < 0:
            at_risk_routes += 1
            frequency_factor = 0.75 if load_factor >= 0.60 else 0.55
            if profit < -0.06 * revenue and fuel_price >= 2.2:
                active = False
                frequency_factor = 0.0
                suspended_routes += 1

        effective_flights = spec.base_frequency * frequency_factor
        flight_hours = distance / aircraft["avg_speed"]
        work_intensity = 0.55 + 0.45 * load_factor
        route_hours = effective_flights * flight_hours * 2.0 * work_intensity * 155.0
        baseline_hours = spec.base_frequency * flight_hours * 2.0 * work_intensity * 155.0

        if active:
            active_routes += 1

        total_required_hours += route_hours
        baseline_required_hours += baseline_hours
        total_revenue += revenue
        total_cost += cost
        total_passengers += passengers

        if not active:
            status = "unsustainable"
        elif profit > 0.12 * revenue:
            status = "healthy"
        else:
            status = "watch"

        passengers_per_flight = passengers / effective_flights if effective_flights else passengers
        route_yield_per_pax = AVG_REVENUE_PER_PASSENGER * REGION_YIELD_FACTOR.get(spec.region, 1.0)
        route_cost_per_pax = AVG_EXPENSE_PER_PASSENGER * REGION_COST_FACTOR.get(spec.region, 1.0)
        per_flight_revenue = passengers_per_flight * route_yield_per_pax
        per_flight_fuel_cost = (fuel_cost / effective_flights) if effective_flights else fuel_cost
        per_flight_cost = (passengers_per_flight * route_cost_per_pax) + per_flight_fuel_cost
        per_flight_profit = per_flight_revenue - per_flight_cost

        route_outputs.append(
            {
                "code": spec.code,
                "name": spec.name,
                "region": spec.region,
                "latitude": spec.latitude,
                "longitude": spec.longitude,
                "distance": round(distance, 1),
                "aircraft_type": spec.aircraft_type,
                "base_demand": spec.base_demand,
                "base_ticket_price": spec.base_ticket_price,
                "business_share": spec.business_share,
                "base_frequency": spec.base_frequency,
                "effective_flights": round(effective_flights, 2),
                "served_passengers": round(passengers, 0),
                "load_factor": round(load_factor, 3),
                "revenue": round(revenue, 2),
                "cost": round(cost, 2),
                "profit": round(profit, 2),
                "margin": round(margin, 4),
                "fuel_share": round(fuel_share, 3),
                "frequency_factor": round(frequency_factor, 2),
                "status": status,
                "active": active,
                "risk_reasons": route_risk_reasons(
                    profit=profit,
                    revenue=revenue,
                    load_factor=load_factor,
                    fuel_share=fuel_share,
                    frequency_factor=frequency_factor,
                    active=active,
                    fuel_price=fuel_price,
                    distance=distance,
                ),
                "per_flight": {
                    "revenue": round(per_flight_revenue, 2),
                    "cost": round(per_flight_cost, 2),
                    "profit": round(per_flight_profit, 2),
                    "passenger_revenue": round(passengers_per_flight * route_yield_per_pax, 2),
                    "ancillary_revenue": round(passengers_per_flight * route_yield_per_pax * 0.08, 2),
                    "fuel_cost": round(per_flight_fuel_cost, 2),
                    "crew_cost": round(crew_cost / effective_flights, 2) if effective_flights else round(crew_cost, 2),
                    "maintenance_cost": round(maintenance_cost / effective_flights, 2) if effective_flights else round(maintenance_cost, 2),
                    "airport_fees": round(airport_fees / effective_flights, 2) if effective_flights else round(airport_fees, 2),
                },
            }
        )

    operating_profit = total_revenue - total_cost
    hours_per_pilot = total_required_hours / TOTAL_PILOTS
    baseline_hours_per_pilot = baseline_required_hours / TOTAL_PILOTS
    lost_hours_per_pilot = max(0.0, baseline_hours_per_pilot - hours_per_pilot)
    utilization = (hours_per_pilot / MONTHLY_HOURS_BENCHMARK) * 100.0

    return {
        "fuel_price": round(fuel_price, 2),
        "summary": {
            "revenue": round(total_revenue, 2),
            "cost": round(total_cost, 2),
            "profit": round(operating_profit, 2),
            "active_routes": active_routes,
            "at_risk_routes": at_risk_routes,
            "suspended_routes": suspended_routes,
            "passengers": round(total_passengers, 0),
            "pilot_hours_per_pilot": round(hours_per_pilot, 1),
            "lost_hours_per_pilot": round(lost_hours_per_pilot, 1),
            "utilization": round(utilization, 1),
        },
        "route_map": {"routes": route_outputs},
        "pilot": {
            "hours_per_pilot": round(hours_per_pilot, 1),
            "lost_hours_per_pilot": round(lost_hours_per_pilot, 1),
            "utilization": round(utilization, 1),
            "benchmark_hours": MONTHLY_HOURS_BENCHMARK,
            "required_hours": round(total_required_hours, 2),
            "baseline_hours": round(baseline_required_hours, 2),
            "state": "red" if utilization < 75 else "yellow" if utilization < 90 else "green",
        },
    }


RAW_BASELINE = _raw_simulation(1.0)
REVENUE_SCALE = ACTUAL_REVENUE_2023_24 / RAW_BASELINE["summary"]["revenue"]
EXPENSE_SCALE = ACTUAL_EXPENSE_2023_24 / RAW_BASELINE["summary"]["cost"]
PILOT_REFERENCE_HOURS_PER_PILOT = RAW_BASELINE["summary"]["pilot_hours_per_pilot"] or 1.0


def simulate_system(fuel_price: float) -> Dict:
    fuel_price = clamp(float(fuel_price), 1.0, 3.0)
    raw = _raw_simulation(fuel_price)
    scaled_routes = []
    total_revenue = 0.0
    total_cost = 0.0

    for route in raw["route_map"]["routes"]:
        spec = ROUTES_BY_CODE[route["code"]]
        aircraft = AIRCRAFT[spec.aircraft_type]
        distance = route["distance"]
        revenue = route["revenue"] * REVENUE_SCALE
        cost = route["cost"] * EXPENSE_SCALE
        profit = revenue - cost
        margin = profit / revenue if revenue else 0.0
        load_factor = route["load_factor"]
        fuel_share = route["fuel_share"]

        active = True
        if profit < 0 and fuel_price >= 1.8:
            active = False
        if profit < -0.04 * revenue and fuel_price >= 2.2:
            active = False
        status = "healthy"
        if not active:
            status = "unsustainable"
        elif profit < 0.08 * revenue:
            status = "watch"

        effective_flights = route["effective_flights"] if active else 0.0
        flight_hours = distance / aircraft["avg_speed"]
        work_intensity = 0.55 + 0.45 * load_factor
        current_route_hours = effective_flights * flight_hours * 2.0 * work_intensity * 155.0
        baseline_route_hours = spec.base_frequency * flight_hours * 2.0 * work_intensity * 155.0

        scaled_route = dict(route)
        scaled_route.update(
            {
                "revenue": round(revenue, 2),
                "cost": round(cost, 2),
                "profit": round(profit, 2),
                "margin": round(margin, 4),
                "active": active,
                "status": status,
                "effective_flights": round(effective_flights, 2),
                "per_flight": route["per_flight"],
                "current_route_hours": round(current_route_hours, 2),
                "baseline_route_hours": round(baseline_route_hours, 2),
                "risk_reasons": route_risk_reasons(
                    profit=profit,
                    revenue=revenue,
                    load_factor=load_factor,
                    fuel_share=fuel_share,
                    frequency_factor=route["frequency_factor"],
                    active=active,
                    fuel_price=raw["fuel_price"],
                    distance=route["distance"],
                ),
            }
        )
        scaled_routes.append(scaled_route)
        total_revenue += revenue
        total_cost += cost

    operating_profit = total_revenue - total_cost
    current_total_required_hours = sum(route["current_route_hours"] for route in scaled_routes)
    baseline_total_required_hours = sum(route["baseline_route_hours"] for route in scaled_routes)
    current_hours_per_pilot = (current_total_required_hours / baseline_total_required_hours) * MONTHLY_HOURS_BENCHMARK if baseline_total_required_hours else 0.0
    normalized_lost_hours_per_pilot = max(0.0, MONTHLY_HOURS_BENCHMARK - current_hours_per_pilot)
    normalized_utilization = current_hours_per_pilot
    pilot_state = "red" if normalized_utilization < 75 else "yellow" if normalized_utilization < 90 else "green"

    revenue_mix = [
        ("Passenger transport & ancillaries", ACTUAL_PASSENGER_REVENUE),
        ("Cargo & logistics", ACTUAL_CARGO_REVENUE),
        ("Airport services", ACTUAL_AIRPORT_SERVICES_REVENUE),
        ("Hotel services", ACTUAL_HOTEL_REVENUE),
        ("Maintenance, repair & overhaul", ACTUAL_MRO_REVENUE),
        ("Aviation university", ACTUAL_AVIATION_UNIVERSITY_REVENUE),
        ("Ground services", ACTUAL_GROUND_SERVICES_REVENUE),
    ]
    revenue_scale_for_mix = total_revenue / ACTUAL_REVENUE_2023_24 if ACTUAL_REVENUE_2023_24 else 1.0
    revenue_values = [item[1] * revenue_scale_for_mix for item in revenue_mix]
    revenue_values = [round(value, 2) for value in revenue_values]
    revenue_values[-1] = round(total_revenue - sum(revenue_values[:-1]), 2)
    revenue_structure = {
        "labels": [item[0] for item in revenue_mix],
        "values": revenue_values,
        "note": "The mix is anchored to Ethiopian Airlines' published 2023/24 segment profile and scaled to the simulated total revenue.",
    }

    fuel_weight = clamp(0.34 + 0.10 * (fuel_price - 1.0), 0.28, 0.54)
    cost_mix = [
        ("Fuel, oil & energy", fuel_weight),
        ("Employee benefits", 0.20),
        ("Maintenance & reserves", 0.15),
        ("Airport, landing & handling", 0.11),
        ("Depreciation & amortization", 0.13),
        ("Leasing & finance", 0.05),
        ("Other operating costs", 0.02),
    ]
    remaining_total = sum(weight for _, weight in cost_mix[1:])
    cost_structure = {
        "labels": [item[0] for item in cost_mix],
        "values": [],
        "note": "The cost buckets follow the airline's main expense drivers and reweight fuel upward as fuel prices rise.",
    }
    cost_values = [total_cost * cost_mix[0][1]]
    cost_values.extend(total_cost * (1.0 - cost_mix[0][1]) * (weight / remaining_total) for _, weight in cost_mix[1:])
    cost_values = [round(value, 2) for value in cost_values]
    cost_values[-1] = round(total_cost - sum(cost_values[:-1]), 2)
    cost_structure["values"] = cost_values

    total_effective_flights = sum(route["effective_flights"] for route in scaled_routes if route["active"] and route["effective_flights"]) if scaled_routes else 0.0
    per_flight_network_revenue = total_revenue / total_effective_flights if total_effective_flights else 0.0
    per_flight_network_cost = total_cost / total_effective_flights if total_effective_flights else 0.0
    per_flight_network_profit = per_flight_network_revenue - per_flight_network_cost

    active_routes = sum(1 for route in scaled_routes if route["active"])
    at_risk_routes = sum(1 for route in scaled_routes if route["status"] == "watch")
    suspended_routes = sum(1 for route in scaled_routes if route["status"] == "unsustainable")

    return {
        "fuel_price": raw["fuel_price"],
        "summary": {
            "revenue": round(total_revenue, 2),
            "cost": round(total_cost, 2),
            "profit": round(operating_profit, 2),
            "active_routes": active_routes,
            "at_risk_routes": at_risk_routes,
            "suspended_routes": suspended_routes,
            "passengers": raw["summary"]["passengers"],
            "pilot_hours_per_pilot": round(current_hours_per_pilot, 1),
            "lost_hours_per_pilot": round(normalized_lost_hours_per_pilot, 1),
            "utilization": round(normalized_utilization, 1),
            "pilot_state": pilot_state,
            "per_flight_network_revenue": round(per_flight_network_revenue, 2),
            "per_flight_network_cost": round(per_flight_network_cost, 2),
            "per_flight_network_profit": round(per_flight_network_profit, 2),
        },
        "income_statement": {
            "labels": ["Revenue", "Cost", "Operating Profit"],
            "values": [round(total_revenue, 2), round(total_cost, 2), round(operating_profit, 2)],
        },
        "structure": {
            "revenue": revenue_structure,
            "cost": cost_structure,
        },
        "route_map": {"routes": scaled_routes},
        "pilot": {
            "hours_per_pilot": round(current_hours_per_pilot, 1),
            "lost_hours_per_pilot": round(normalized_lost_hours_per_pilot, 1),
            "utilization": round(normalized_utilization, 1),
            "state": pilot_state,
            "benchmark_hours": MONTHLY_HOURS_BENCHMARK,
            "required_hours": round(current_total_required_hours, 2),
            "baseline_hours": round(baseline_total_required_hours, 2),
        },
    }


@app.route("/")
def index():
    initial_state = simulate_system(1.0)
    return render_template("index.html", initial_state=initial_state)


@app.route("/api/simulate")
def api_simulate():
    fuel_price = request.args.get("fuel_price", 1.0)
    return jsonify(simulate_system(fuel_price))


if __name__ == "__main__":
    app.run(debug=True)
