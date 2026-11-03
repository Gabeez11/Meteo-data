import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { fetchAggregates, fetchStations } from "./api";
import { fetchForecast } from "./forecast";
import type { AggregateResponse, ForecastResponse, Station } from "./types";

const HOUR_OPTIONS = [6, 12, 24, 48, 72, 168];

interface VarDef { key: string; label: string; unit: string; }

const CHART_VARIABLES: VarDef[] = [
  { key: "solar_radiation_avg", label: "Solar radiation", unit: "W/m²" },
  { key: "temperature_avg", label: "Temperature", unit: "°C" },
  { key: "uv_index_avg", label: "UV index", unit: "" },
  { key: "humidity_avg", label: "Humidity", unit: "%" },
  { key: "cloud_cover_avg", label: "Cloud cover", unit: "%" },
  { key: "wind_speed_avg", label: "Wind speed", unit: "km/h" },
];

const SECONDARY_CHART_VARIABLES: VarDef[] = [
  { key: "precipitation_rate_avg", label: "Precip. rate", unit: "mm/h" },
  { key: "precipitation_total_avg", label: "Precip. total", unit: "mm" },
];

const SUMMARY_VARIABLES: VarDef[] = [
  ...CHART_VARIABLES,
  ...SECONDARY_CHART_VARIABLES,
  { key: "pressure_avg", label: "Pressure", unit: "hPa" },
  { key: "wind_gust_avg", label: "Wind gust", unit: "km/h" },
  { key: "wind_direction_avg", label: "Wind direction", unit: "°" },
];

const OPTIONAL_CHART_VARIABLES: VarDef[] = [{ key: "pressure_avg", label: "Pressure", unit: "hPa" }];
const COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#00C49F", "#FF8042"];

function formatHour(hour: string): string {
  const d = new Date(hour + ":00Z");
  if (Number.isNaN(d.getTime())) return hour;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function forecastHourKey(time: string): string {
  const prefix = time.slice(0, 13);
  return `${prefix.slice(0, 10)} ${prefix.slice(11, 13)}:00`;
}

function forecastLineFor(variableKey: string): { label: string; color: string } | null {
  switch (variableKey) {
    case "temperature_avg": return { label: "Temperature Forecast", color: COLORS[3] };
    case "humidity_avg": return { label: "Humidity Forecast", color: COLORS[1] };
    case "cloud_cover_avg": return { label: "Cloud Cover Forecast", color: COLORS[4] };
    case "pressure_avg": return { label: "Pressure Forecast", color: COLORS[5] };
    case "wind_speed_avg": return { label: "Wind Speed Forecast", color: COLORS[2] };
    case "precipitation_rate_avg": return { label: "Precip. Rate Forecast", color: COLORS[0] };
    case "precipitation_total_avg": return { label: "Precipitation Forecast", color: COLORS[0] };
    default: return null;
  }
}

interface Category { label: string; color: string; }
const UV_TIERS: { max: number; label: string; color: string }[] = [
  { max: 2, label: "Low", color: "#4caf50" }, { max: 5, label: "Moderate", color: "#ffb300" },
  { max: 7, label: "High", color: "#fb8c00" }, { max: 10, label: "Very High", color: "#e53935" },
  { max: Infinity, label: "Extreme", color: "#7e57c2" },
];
function uvInfo(v: number): { label: string; color: string; index: number } {
  let idx = 0;
  for (let i = 0; i < UV_TIERS.length; i++) if (v <= UV_TIERS[i]!.max) { idx = i; break; }
  const t = UV_TIERS[idx] ?? UV_TIERS[UV_TIERS.length - 1]!;
  return { label: t.label, color: t.color, index: idx };
}
function solarCategory(v: number): Category {
  if (v <= 100) return { label: "Very Low", color: "#90a4ae" };
  if (v <= 300) return { label: "Low", color: "#42a5f5" };
  if (v <= 600) return { label: "Moderate", color: "#ffb300" };
  if (v <= 900) return { label: "High", color: "#fb8c00" };
  return { label: "Very High", color: "#e53935" };
}
function tempColor(v: number): string {
  if (v <= 0) return "#2196f3";
  if (v < 15) return "#4caf50";
  if (v < 25) return "#ffb300";
  return "#e53935";
}
export default function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<AggregateResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aggregateInFlight = useRef(false);
  const forecastInFlight = useRef(false);

  useEffect(() => {
    fetchStations(24).then(setStations).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Fetch once per mount (first load / browser refresh) and whenever the
    // user changes a filter. No polling: an idle tab generates zero queries
    // (D1 read conservation, see docs/emergency-d1-mode.md).
    const refresh = async () => {
      if (cancelled || aggregateInFlight.current) return;
      aggregateInFlight.current = true;
      setError(null);
      try {
        const next = await fetchAggregates({ hours, station: selected || undefined });
        if (!cancelled) setData(next);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        aggregateInFlight.current = false;
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [hours, selected]);

  useEffect(() => {
    let cancelled = false;
    // Same policy as aggregates: fetch once per mount, no polling.
    const refresh = async () => {
      if (cancelled || forecastInFlight.current) return;
      forecastInFlight.current = true;
      try {
        const next = await fetchForecast();
        if (!cancelled && next) setForecast(next);
      } finally {
        forecastInFlight.current = false;
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  const stationNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stations) map.set(s.id, s.name);
    return map;
  }, [stations]);
  const stationLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const station of stations) {
      const source = station.source_id.startsWith("weather-com")
        ? "Weather.com PWS"
        : station.source_id.startsWith("open-meteo")
          ? "Open-Meteo (estimate)"
          : station.source_id;
      map.set(station.id, `${station.name} — ${source}`);
    }
    return map;
  }, [stations]);
  const dataByStation = useMemo(() => {
    const map = new Map<string, Map<string, AggregateResponse["rows"][number]>>();
    for (const row of data?.rows ?? []) {
      let byHour = map.get(row.station_id);
      if (!byHour) { byHour = new Map(); map.set(row.station_id, byHour); }
      byHour.set(row.hour, row);
    }
    return map;
  }, [data]);
  const sortedHours = useMemo(() => Array.from(new Set((data?.rows ?? []).map((r) => r.hour))).sort(), [data]);
  const forecastByHour = useMemo(() => {
    const map = new Map<string, ForecastResponse["hourly"][number]>();
    for (const h of forecast?.hourly ?? []) map.set(forecastHourKey(h.time), h);
    return map;
  }, [forecast]);
  const futureForecastHours = useMemo(() => {
    const latestObserved = sortedHours[sortedHours.length - 1];
    const result = Array.from(forecastByHour.keys()).filter((h) => latestObserved ? h > latestObserved : true);
    result.sort(); return result;
  }, [forecastByHour, sortedHours]);
  const chartHours = useMemo(() => [...sortedHours, ...futureForecastHours], [sortedHours, futureForecastHours]);
  const forecastValueFor = (hour: string, variableKey: string): number | null => {
    const entry = forecastByHour.get(hour); if (!entry) return null;
    let value: number | null | undefined = null;
    if (variableKey === "temperature_avg") value = entry.temperature;
    else if (variableKey === "humidity_avg") value = entry.humidity;
    else if (variableKey === "cloud_cover_avg") value = entry.cloudCover;
    else if (variableKey === "pressure_avg") value = entry.surfacePressure ?? null;
    else if (variableKey === "wind_speed_avg") value = entry.windSpeed ?? null;
    else if (variableKey === "precipitation_rate_avg" || variableKey === "precipitation_total_avg") value = entry.precipitation;
    if (typeof value !== "number") return null;
    return Math.round(value * 100) / 100;
  };
  const forecastSummary = useMemo(() => {
    const hourly = forecast?.hourly ?? []; if (hourly.length === 0) return null;
    const current = hourly[0]!, next6 = hourly.slice(0, 6), next24 = hourly.slice(0, 24);
    const rainProb = Math.max(0, ...next6.map((h) => h.precipitationProbability));
    const temps = next24.map((h) => h.temperature);
    return { currentTemp: current.temperature, rainProb, maxTemp: Math.max(...temps), minTemp: Math.min(...temps) };
  }, [forecast]);
  const visibleStationIds = useMemo(() => {
    const ids = new Set((data?.rows ?? []).map((r) => r.station_id));
    if (selected) return ids.has(selected) ? [selected] : [];
    return Array.from(ids);
  }, [data, selected]);
  const latestRowsByStation = useMemo(() => {
    const map = new Map<string, AggregateResponse["rows"][number]>();
    for (const [stationId, rowsByHour] of dataByStation) {
      const hours = Array.from(rowsByHour.keys()).sort();
      const latestHour = hours[hours.length - 1];
      const latestRow = latestHour ? rowsByHour.get(latestHour) : undefined;
      if (latestRow) map.set(stationId, latestRow);
    }
    return map;
  }, [dataByStation]);
  return (
    <div className="app">
      <header className="header"><h1>Meteo Data Dashboard</h1><div className="controls">
        <label>Station<select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">All stations</option>{stations.map((s) => <option key={s.id} value={s.id}>{stationLabels.get(s.id) ?? s.name} ({s.id})</option>)}</select></label>
        <label>Range<select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h} hours</option>)}</select></label>
      </div></header>
      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="loading">Loading…</div>}
      {data && <main>
        <section className="summary" aria-label="Latest readings"><div className="summary-grid primary-indicators">
          {([
            { key: "solar_radiation_avg", label: "☀ Solar radiation", unit: "W/m²" },
            { key: "uv_index_avg", label: "☀ UV Index", unit: "" },
            { key: "temperature_avg", label: "🌡 Temperature", unit: "°C" },
          ] as const).map((indicator) => <section key={indicator.key} className={`summary-card primary-indicator ${indicator.key === "solar_radiation_avg" ? "solar-indicator" : ""}`}>
            <h2 className="summary-label">{indicator.label}</h2>
            <div className="indicator-readings">{visibleStationIds.map((sid) => {
              const row = latestRowsByStation.get(sid);
              const value = row?.[indicator.key] ?? null;
              const category = indicator.key === "solar_radiation_avg" && value !== null ? solarCategory(value) : null;
              const uv = indicator.key === "uv_index_avg" && value !== null ? uvInfo(value) : null;
              return <div className="indicator-reading" key={sid}>
                <span className="indicator-source">{stationLabels.get(sid) ?? stationNames.get(sid) ?? sid}</span>
                {value === null ? <span className="indicator-value">–</span> : <>
                  {indicator.key === "solar_radiation_avg" && <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (value / 900) * 100)}%`, background: category?.color }} /></div>}
                  <span className={`indicator-value ${indicator.key === "solar_radiation_avg" ? "solar-value" : ""}`} style={{ color: category?.color ?? uv?.color ?? (indicator.key === "temperature_avg" ? tempColor(value) : undefined) }}>
                    {value.toFixed(indicator.key === "temperature_avg" ? 1 : indicator.key === "uv_index_avg" ? 1 : 0)}{indicator.unit ? ` ${indicator.unit}` : ""}
                    {uv && <small> · {uv.label}</small>}
                  </span>
                </>}
                {row && <span className="indicator-hour">{formatHour(row.hour)} · hourly average</span>}
              </div>;
            })}</div>
          </section>)}
          {forecast && forecast.hourly.length > 0 && forecastSummary && <div className="summary-card forecast-card"><span className="summary-label">📡 Forecast</span><div className="forecast-temp">{forecastSummary.currentTemp.toFixed(1)}°C</div><div className="forecast-detail">Rain next 6h: {forecastSummary.rainProb.toFixed(0)}%</div><div className="forecast-detail">Today: {forecastSummary.minTemp.toFixed(0)}° / {forecastSummary.maxTemp.toFixed(0)}°</div><div className="forecast-attribution">Forecast provided by Open-Meteo</div></div>}
        </div></section>
        {CHART_VARIABLES.map((v) => {
          const forecastLine = forecastLineFor(v.key);
          const hoursForChart = forecastLine ? chartHours : sortedHours;
          const isSolar = v.key === "solar_radiation_avg";
          return <section key={v.key} className={`chart-card ${isSolar ? "chart-card-primary" : ""}`}>
            <h2>{v.label}{v.unit ? ` (${v.unit})` : ""}</h2>
            <div className={`chart-wrap ${isSolar ? "chart-wrap-primary" : ""}`}>
              <ResponsiveContainer width="100%" height="100%"><LineChart data={hoursForChart.map((hour) => {
                const point: Record<string, unknown> = { hour: formatHour(hour) };
                for (const sid of visibleStationIds) {
                  const raw = dataByStation.get(sid)?.get(hour)?.[v.key as keyof AggregateResponse["rows"][number]] ?? null;
                  point[sid] = typeof raw === "number" ? Math.round(raw * 100) / 100 : raw;
                }
                if (forecastLine) point.forecast = hour > (sortedHours[sortedHours.length - 1] ?? "") ? forecastValueFor(hour, v.key) : null;
                return point;
              })}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={45} /><Tooltip /><Legend />
                {visibleStationIds.map((sid, i) => <Line key={sid} type="monotone" dataKey={sid} name={stationLabels.get(sid) ?? stationNames.get(sid) ?? sid} stroke={COLORS[i % COLORS.length]} dot={false} connectNulls />)}
                {forecast && forecastLine && futureForecastHours.length > 0 && <Line key="forecast" type="monotone" dataKey="forecast" name={forecastLine.label} stroke={forecastLine.color} strokeDasharray="5 5" dot={false} connectNulls={false} />}
              </LineChart></ResponsiveContainer>
            </div>
          </section>;
        })}
        <section className="chart-card"><h2>Wind</h2><div className="wind-row">{visibleStationIds.map((sid) => { const latestRow = latestRowsByStation.get(sid); const dir = latestRow?.wind_direction_avg ?? null; const speed = latestRow?.wind_speed_avg ?? null; const gust = latestRow?.wind_gust_avg ?? null; return <div key={sid} className="wind-item"><div className="station-label">{stationLabels.get(sid) ?? stationNames.get(sid) ?? sid}</div><div className="compass"><span className="compass-n">N</span><span className="compass-e">E</span><span className="compass-s">S</span><span className="compass-w">W</span><span className="compass-arrow" style={{ transform: `translate(-50%, -50%) rotate(${dir !== null ? (dir % 360) + 180 : 0}deg)` }} title={`${dir !== null ? dir.toFixed(0) + "°" : "no data"}`}>↑</span></div><div className="wind-speed">{speed !== null ? `${speed.toFixed(1)} km/h` : "–"}{gust !== null ? ` · gust ${gust.toFixed(1)} km/h` : ""}<span className="wind-direction">{dir !== null ? `${dir.toFixed(0)}°` : ""}</span></div></div>; })}</div></section>
        {[...SECONDARY_CHART_VARIABLES, ...OPTIONAL_CHART_VARIABLES].map((v) => {
          const forecastLine = forecastLineFor(v.key);
          const hoursForChart = forecastLine ? chartHours : sortedHours;
          return <section key={v.key} className="chart-card secondary-data">
            <h2>{v.label}{v.unit ? ` (${v.unit})` : ""}</h2>
            <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={hoursForChart.map((hour) => {
              const point: Record<string, unknown> = { hour: formatHour(hour) };
              for (const sid of visibleStationIds) {
                const raw = dataByStation.get(sid)?.get(hour)?.[v.key as keyof AggregateResponse["rows"][number]] ?? null;
                point[sid] = typeof raw === "number" ? Math.round(raw * 100) / 100 : raw;
              }
              if (forecastLine) point.forecast = hour > (sortedHours[sortedHours.length - 1] ?? "") ? forecastValueFor(hour, v.key) : null;
              return point;
            })}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={45} /><Tooltip /><Legend />
              {visibleStationIds.map((sid, i) => <Line key={sid} type="monotone" dataKey={sid} name={stationLabels.get(sid) ?? stationNames.get(sid) ?? sid} stroke={COLORS[i % COLORS.length]} dot={false} connectNulls />)}
              {forecast && forecastLine && futureForecastHours.length > 0 && <Line key="forecast" type="monotone" dataKey="forecast" name={forecastLine.label} stroke={forecastLine.color} strokeDasharray="5 5" dot={false} connectNulls={false} />}
            </LineChart></ResponsiveContainer></div>
          </section>;
        })}
        <section className="chart-card secondary-data"><h2>Latest hourly averages</h2><div className="table-wrap"><table><thead><tr><th>Station</th><th>Hour</th>{SUMMARY_VARIABLES.map((v) => <th key={v.key}>{v.label}</th>)}</tr></thead><tbody>{data?.rows.slice().sort((a, b) => b.hour.localeCompare(a.hour)).slice(0, visibleStationIds.length * 2).map((row, i) => <tr key={i}><td>{stationLabels.get(row.station_id) ?? stationNames.get(row.station_id) ?? row.station_id}</td><td>{formatHour(row.hour)}</td>{SUMMARY_VARIABLES.map((v) => <td key={v.key}>{row[v.key as keyof AggregateResponse["rows"][number]] !== null ? Number(row[v.key as keyof AggregateResponse["rows"][number]]).toFixed(1) : "–"}</td>)}</tr>)}</tbody></table></div></section>
      </main>}
    </div>
  );
}
