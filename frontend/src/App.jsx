import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Thermometer,
  Gauge,
  AlertTriangle,
  CheckCircle,
  Brain,
  Clock,
  Layers,
  Sliders,
  Database,
  RefreshCw,
  TrendingUp,
  AlertOctagon,
  ArrowRight,
  Server,
  Zap,
  ShieldAlert,
  RotateCcw,
} from "lucide-react";
import {
  LineChart,
  Line,
  ComposedChart,
  Area,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import "./index.css";

const API_BASE = "http://localhost:8000";
const MAX_LIVE_POINTS = 25;

const MACHINE_OPTIONS = [
  { id: "Machine-01", name: "CNC Milling Alpha" },
  { id: "Machine-02", name: "Lathe Pro-X" },
  { id: "Machine-03", name: "Heavy Stamping Unit" },
  { id: "Machine-04", name: "Robotic Drill Rig" },
];

const DRIFT_FEATURES = [
  { key: "process_temperature", label: "Process Temp", unit: "K", mean: 310.0, std: 1.48, lower: 307.04, upper: 312.96 },
  { key: "torque", label: "Torque", unit: "Nm", mean: 40.0, std: 9.97, lower: 20.06, upper: 59.94 },
  { key: "air_temperature", label: "Air Temp", unit: "K", mean: 300.0, std: 2.0, lower: 296.0, upper: 304.0 },
  { key: "rpm", label: "Rotational Speed", unit: "RPM", mean: 1538.8, std: 179.3, lower: 1180.2, upper: 1897.4 },
  { key: "tool_wear", label: "Tool Wear", unit: "min", mean: 108.0, std: 63.65, lower: 0.0, upper: 235.3 },
];

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [selectedMachine, setSelectedMachine] = useState("Machine-01");
  const [latest, setLatest] = useState(null);
  const [fleet, setFleet] = useState({ total: 4, healthy: 2, warning: 1, critical: 1, drifting: 2, machines: [] });
  const [sensorHistory, setSensorHistory] = useState([]);

  // Module 4 Drift Monitoring States
  const [driftFeature, setDriftFeature] = useState("process_temperature");
  const [driftData, setDriftData] = useState(null);
  const [driftSimLoading, setDriftSimLoading] = useState(false);

  // History Tab States
  const [historyData, setHistoryData] = useState({ series: [], incidents: [], summary: {}, source: "influxdb" });
  const [historyLoading, setHistoryLoading] = useState(false);

  // What-If Simulation States
  const [whatIf, setWhatIf] = useState({
    air_temperature: 300.0,
    process_temperature: 312.0,
    rpm: 1450.0,
    torque: 48.0,
    tool_wear: 120.0,
  });
  const [whatIfResult, setWhatIfResult] = useState(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);

  // Poll Fleet overview
  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/fleet`);
      if (res.ok) {
        const data = await res.json();
        setFleet(data);
      }
    } catch {
      // silently ignore if backend starting
    }
  }, []);

  // Poll latest telemetry for selected machine
  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/latest?machine_id=${selectedMachine}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.status === "WAITING") return;

      setLatest(data);

      setSensorHistory((prev) => {
        const next = [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            process_temperature: data.process_temperature,
            air_temperature: data.air_temperature,
            rpm: data.rpm,
            torque: data.torque,
            tool_wear: data.tool_wear,
            failure_percentage: data.failure_percentage,
          },
        ];
        return next.length > MAX_LIVE_POINTS ? next.slice(1) : next;
      });
    } catch {
      // Backend temporarily offline
    }
  }, [selectedMachine]);

  // Poll Module 4 Drift Detection data
  const fetchDrift = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/drift?machine_id=${selectedMachine}&feature=${driftFeature}`);
      if (res.ok) {
        const data = await res.json();
        setDriftData(data);
      }
    } catch {
      // Fallback to client-computed drift from latest if /drift endpoint unavailable
    }
  }, [selectedMachine, driftFeature]);

  // Trigger or reset simulated covariate drift for live demonstration
  const handleSimulateDrift = async (mode) => {
    setDriftSimLoading(true);
    try {
      const res = await fetch(`${API_BASE}/drift/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine_id: selectedMachine, mode }),
      });

      if (res.ok) {
        await Promise.all([fetchLatest(), fetchDrift(), fetchFleet()]);
      } else {
        // Fallback via /ingest if backend is running an older route table
        const payload =
          mode === "reset"
            ? {
                machine_id: selectedMachine,
                air_temperature: 300.1,
                process_temperature: 310.1,
                rpm: 1530.0,
                torque: 39.5,
                tool_wear: 60.0,
              }
            : {
                machine_id: selectedMachine,
                air_temperature: 306.2,
                process_temperature: 315.8,
                rpm: 1120.0,
                torque: 69.5,
                tool_wear: 230.0,
              };
        await fetch(`${API_BASE}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await Promise.all([fetchLatest(), fetchDrift(), fetchFleet()]);
      }
    } catch (err) {
      console.error("Failed to simulate drift:", err);
    } finally {
      setDriftSimLoading(false);
    }
  };

  // Fetch History data from InfluxDB
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const url = `${API_BASE}/history?machine_id=${selectedMachine}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedMachine]);

  // Run What-If Prediction
  const runWhatIfSimulation = async () => {
    setWhatIfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine_id: selectedMachine,
          ...whatIf,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWhatIfResult(data);
      }
    } catch (err) {
      console.error("Simulation error:", err);
    } finally {
      setWhatIfLoading(false);
    }
  };

  useEffect(() => {
    fetchFleet();
    fetchLatest();
    fetchDrift();

    const fleetInterval = setInterval(fetchFleet, 3000);
    const latestInterval = setInterval(() => {
      fetchLatest();
      fetchDrift();
    }, 2000);

    return () => {
      clearInterval(fleetInterval);
      clearInterval(latestInterval);
    };
  }, [fetchFleet, fetchLatest, fetchDrift]);

  useEffect(() => {
    if (activePage === "History") {
      fetchHistory();
    }
  }, [activePage, fetchHistory]);

  // Clear live history when switching machine
  const handleMachineChange = (mid) => {
    setSelectedMachine(mid);
    setSensorHistory([]);
  };

  const isWarning = latest?.prediction === 1 || latest?.health_tier === "Warning" || latest?.health_tier === "Critical";
  const isAnomaly = latest?.is_anomaly ?? false;

  const getTierBadge = (tier) => {
    if (tier === "Critical") return <span className="tier-badge badge-critical">Critical</span>;
    if (tier === "Warning") return <span className="tier-badge badge-warning">Warning</span>;
    return <span className="tier-badge badge-healthy">Healthy</span>;
  };

  // Compute active drift model (from /drift endpoint or fallback from latest reading)
  const activeFeatureMeta = DRIFT_FEATURES.find((f) => f.key === driftFeature) || DRIFT_FEATURES[0];
  const backendDrift = driftData?.drift || latest?.drift;

  const computedFeatures = {};
  DRIFT_FEATURES.forEach((f) => {
    const bf = backendDrift?.features?.[f.key];
    if (bf) {
      computedFeatures[f.key] = bf;
    } else {
      const curVal = latest?.[f.key] ?? f.mean;
      const zShift = Math.abs(curVal - f.mean) / f.std;
      const signedZ = (curVal - f.mean) / f.std;
      const psi = 0.5 * Math.pow(zShift, 2);
      const status = zShift >= 2.2 ? "Severe Drift" : zShift >= 1.5 ? "Moderate Drift" : "Stable";
      computedFeatures[f.key] = {
        feature: f.key,
        label: f.label,
        unit: f.unit,
        train_mean: f.mean,
        train_std: f.std,
        train_lower: f.lower,
        train_upper: f.upper,
        live_current: Number(curVal.toFixed(2)),
        live_mean: Number(curVal.toFixed(2)),
        z_shift: Number(zShift.toFixed(2)),
        signed_z: Number(signedZ.toFixed(2)),
        psi: Number(psi.toFixed(3)),
        is_outside_band: curVal < f.lower || curVal > f.upper,
        status,
      };
    }
  });

  const driftedFeatureKeys =
    backendDrift?.drifted_features ||
    Object.values(computedFeatures)
      .filter((f) => f.status !== "Stable")
      .map((f) => f.feature);

  const maxZShift =
    backendDrift?.max_z_shift ??
    Math.max(...Object.values(computedFeatures).map((f) => f.z_shift || 0), 0);

  const avgPsi =
    backendDrift?.avg_psi ??
    Number(
      (
        Object.values(computedFeatures).reduce((acc, f) => acc + (f.psi || 0), 0) /
        DRIFT_FEATURES.length
      ).toFixed(3)
    );

  const driftSeverity =
    backendDrift?.drift_severity ||
    (maxZShift >= 2.2 ? "Critical" : maxZShift >= 1.5 ? "Warning" : "Stable");

  const isMachineDrifting = backendDrift?.is_drifting ?? driftSeverity !== "Stable";

  const driftScore =
    backendDrift?.drift_score ?? Number(Math.min(100, (maxZShift / 3.5) * 100).toFixed(1));

  const driftAlertMessage =
    backendDrift?.alert_message ||
    (isMachineDrifting
      ? `DATA DRIFT DETECTED: Live sensor distribution for ${driftedFeatureKeys
          .map((k) => computedFeatures[k]?.label || k)
          .join(", ")} has shifted outside the AI4I training baseline (Max Shift: ${maxZShift.toFixed(
          2
        )}σ, PSI: ${avgPsi.toFixed(3)}). Model retraining recommended.`
      : "All 5 live sensor distributions align with the AI4I 2020 training dataset baseline (within ±2σ operational envelope).");

  // Build "Sensor Data vs. Training Data" chart series
  const rawSeries =
    driftData?.comparison_series && driftData.comparison_series.length > 0
      ? driftData.comparison_series
      : sensorHistory;

  const selectedFeatStats = computedFeatures[driftFeature] || computedFeatures.process_temperature;

  const driftChartSeries = rawSeries.map((pt) => {
    const liveVal = Number(pt[driftFeature] ?? selectedFeatStats.live_current);
    const tMean = Number(pt[`${driftFeature}_train_mean`] ?? selectedFeatStats.train_mean);
    const tLower = Number(pt[`${driftFeature}_train_lower`] ?? selectedFeatStats.train_lower);
    const tUpper = Number(pt[`${driftFeature}_train_upper`] ?? selectedFeatStats.train_upper);
    return {
      time: pt.time,
      live_value: liveVal,
      train_mean: tMean,
      train_lower: tLower,
      train_upper: tUpper,
      train_band: [tLower, tUpper],
      out_of_bounds: liveVal < tLower || liveVal > tUpper ? liveVal : null,
    };
  });

  // Render the Module 4 Drift Detection Panel (used on Dashboard and Drift Monitor tab)
  const renderDriftDetectionPanel = () => (
    <section className={`panel drift-panel ${isMachineDrifting ? "drift-panel-alert" : ""}`}>
      <div className="drift-panel-top">
        <div>
          <div className="drift-title-row">
            <TrendingUp size={22} className={isMachineDrifting ? "icon-drift-alert" : "icon-drift-ok"} />
            <h2>Module 4 Monitoring: Live Sensor Data vs. Training Data Drift</h2>
            <span className={`drift-status-pill ${isMachineDrifting ? "pill-drift-red" : "pill-drift-green"}`}>
              {isMachineDrifting ? `● DRIFT ALERT (${driftSeverity.toUpperCase()})` : "● DISTRIBUTION STABLE"}
            </span>
          </div>
          <p className="description">
            Compares live streaming telemetry against the <strong>AI4I 2020 Training Dataset Baseline</strong> (Mean μ &amp; ±2σ Normal Envelope) using Z-Score Shift &amp; Population Stability Index (PSI).
          </p>
        </div>

        <div className="drift-actions">
          <button
            className="drift-sim-btn drift-trigger-btn"
            onClick={() => handleSimulateDrift("drift")}
            disabled={driftSimLoading}
            title="Inject covariate sensor drift outside training bounds"
          >
            <ShieldAlert size={15} />
            {driftSimLoading ? "Updating..." : "Simulate Machine Drift"}
          </button>
          <button
            className="drift-sim-btn drift-reset-btn"
            onClick={() => handleSimulateDrift("reset")}
            disabled={driftSimLoading}
            title="Restore machine telemetry to nominal training baseline"
          >
            <RotateCcw size={15} />
            Reset to Baseline
          </button>
        </div>
      </div>

      {/* RED ALERT BANNER WHEN MACHINE DRIFTS */}
      <div className={`drift-banner ${isMachineDrifting ? "drift-banner-red" : "drift-banner-green"}`}>
        <div className="drift-banner-left">
          {isMachineDrifting ? <AlertOctagon size={28} /> : <CheckCircle size={28} />}
          <div>
            <div className="drift-banner-headline">
              <h3>
                {isMachineDrifting
                  ? `Covariate Data Drift Detected on ${latest?.machine_name || selectedMachine}`
                  : `No Data Drift Detected — ${latest?.machine_name || selectedMachine} Matches Training Baseline`}
              </h3>
              {isMachineDrifting && (
                <span className="retrain-badge">MODEL RETRAINING RECOMMENDED</span>
              )}
            </div>
            <p>{driftAlertMessage}</p>
          </div>
        </div>

        <div className="drift-banner-metrics">
          <div className="drift-mini-stat">
            <span>Max Z-Shift</span>
            <strong className={maxZShift >= 1.5 ? "text-red" : "text-green"}>{maxZShift.toFixed(2)}σ</strong>
          </div>
          <div className="drift-mini-stat">
            <span>Composite PSI</span>
            <strong className={avgPsi >= 0.12 ? "text-red" : "text-green"}>{avgPsi.toFixed(3)}</strong>
          </div>
          <div className="drift-mini-stat">
            <span>Drift Severity</span>
            <strong className={isMachineDrifting ? "text-red" : "text-green"}>{driftScore}%</strong>
          </div>
        </div>
      </div>

      {/* FEATURE SELECTOR + LIVE CHART: SENSOR DATA VS TRAINING DATA */}
      <div className="drift-Workspace">
        <div className="drift-chart-card">
          <div className="drift-chart-header">
            <div>
              <h3>
                Live Sensor Data vs. Training Data Baseline ({activeFeatureMeta.label} in {activeFeatureMeta.unit})
              </h3>
              <p>
                Shaded corridor shows <strong>Training Normal Envelope (μ ± 2σ)</strong>; solid line shows <strong>Live Sensor Stream</strong>
              </p>
            </div>

            <div className="drift-feature-tabs">
              {DRIFT_FEATURES.map((f) => {
                const fStat = computedFeatures[f.key];
                const fDrifting = fStat && fStat.status !== "Stable";
                return (
                  <button
                    key={f.key}
                    className={`drift-tab-btn ${driftFeature === f.key ? "active" : ""} ${
                      fDrifting ? "tab-has-drift" : ""
                    }`}
                    onClick={() => setDriftFeature(f.key)}
                  >
                    {fDrifting && <span className="tab-drift-dot" />}
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="drift-chart-container">
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={driftChartSeries} margin={{ top: 12, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                <YAxis
                  stroke="#64748b"
                  fontSize={12}
                  domain={["auto", "auto"]}
                  unit={` ${activeFeatureMeta.unit}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    color: "#f8fafc",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    fontSize: "13px",
                  }}
                />
                <Legend />

                {/* Training ±2σ Shaded Reference Band */}
                <Area
                  type="monotone"
                  dataKey="train_band"
                  name="Training Normal Envelope (μ ± 2σ)"
                  fill="#dbeafe"
                  stroke="#93c5fd"
                  fillOpacity={0.55}
                  strokeDasharray="4 4"
                  isAnimationActive={false}
                />

                {/* Training Mean Reference Line */}
                <Line
                  type="monotone"
                  dataKey="train_mean"
                  name="Training Baseline Mean (μ)"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={false}
                />

                <ReferenceLine
                  y={selectedFeatStats.train_upper}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  label={{
                    value: `+2σ (${selectedFeatStats.train_upper} ${activeFeatureMeta.unit})`,
                    position: "insideTopRight",
                    fill: "#b45309",
                    fontSize: 11,
                  }}
                />
                <ReferenceLine
                  y={selectedFeatStats.train_lower}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  label={{
                    value: `-2σ (${selectedFeatStats.train_lower} ${activeFeatureMeta.unit})`,
                    position: "insideBottomRight",
                    fill: "#b45309",
                    fontSize: 11,
                  }}
                />

                {/* Live Sensor Stream */}
                <Line
                  type="monotone"
                  dataKey="live_value"
                  name={`Live ${activeFeatureMeta.label} (${activeFeatureMeta.unit})`}
                  stroke={selectedFeatStats.status !== "Stable" ? "#dc2626" : "#059669"}
                  strokeWidth={3}
                  dot={{
                    r: 4,
                    fill: selectedFeatStats.status !== "Stable" ? "#dc2626" : "#059669",
                    strokeWidth: 1,
                    stroke: "#ffffff",
                  }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 4-Card Comparison Strip for Selected Sensor */}
          <div className="drift-comparison-strip">
            <div className="drift-strip-item">
              <span>Training Baseline Mean (μ)</span>
              <strong>
                {selectedFeatStats.train_mean} {selectedFeatStats.unit}
              </strong>
            </div>
            <div className="drift-strip-item">
              <span>Training ±2σ Envelope</span>
              <strong>
                {selectedFeatStats.train_lower} – {selectedFeatStats.train_upper} {selectedFeatStats.unit}
              </strong>
            </div>
            <div className="drift-strip-item">
              <span>Live Sensor Reading</span>
              <strong className={selectedFeatStats.status !== "Stable" ? "text-red" : "text-green"}>
                {selectedFeatStats.live_current} {selectedFeatStats.unit}
              </strong>
            </div>
            <div className="drift-strip-item">
              <span>Feature Shift / PSI</span>
              <strong className={selectedFeatStats.status !== "Stable" ? "text-red" : "text-green"}>
                {selectedFeatStats.signed_z > 0 ? `+${selectedFeatStats.signed_z}` : selectedFeatStats.signed_z}σ (PSI: {selectedFeatStats.psi})
              </strong>
            </div>
          </div>
        </div>

        {/* PER-FEATURE DRIFT BREAKDOWN TABLE / METERS */}
        <div className="drift-features-card">
          <h3>Per-Sensor Distribution Shift (All 5 Features)</h3>
          <p className="description">
            Threshold: <strong>Z ≥ 1.5σ</strong> or <strong>PSI ≥ 0.12</strong> triggers drift warning; <strong>Z ≥ 2.2σ</strong> triggers red alert.
          </p>

          <div className="drift-feature-list">
            {DRIFT_FEATURES.map((f) => {
              const st = computedFeatures[f.key];
              const pct = Math.min(100, (st.z_shift / 3.5) * 100);
              const barColor =
                st.status === "Severe Drift"
                  ? "#dc2626"
                  : st.status === "Moderate Drift"
                  ? "#f59e0b"
                  : "#10b981";

              return (
                <div
                  key={f.key}
                  className={`drift-feature-row ${driftFeature === f.key ? "row-selected" : ""} ${
                    st.status === "Severe Drift" ? "row-severe" : ""
                  }`}
                  onClick={() => setDriftFeature(f.key)}
                >
                  <div className="drift-feature-row-top">
                    <div>
                      <strong>{st.label}</strong>
                      <span className="drift-sub-bounds">
                        Train μ: {st.train_mean} {st.unit} (±{st.train_std}) | Live: <b>{st.live_current} {st.unit}</b>
                      </span>
                    </div>
                    <span
                      className={`drift-chip ${
                        st.status === "Severe Drift"
                          ? "chip-severe"
                          : st.status === "Moderate Drift"
                          ? "chip-moderate"
                          : "chip-stable"
                      }`}
                    >
                      {st.status}
                    </span>
                  </div>

                  <div className="drift-bar-track">
                    <div
                      className="drift-bar-fill"
                      style={{ width: `${pct}%`, backgroundColor: barColor }}
                    />
                  </div>

                  <div className="drift-feature-row-bottom">
                    <span>
                      Shift: <strong>{st.signed_z > 0 ? `+${st.signed_z}` : st.signed_z}σ</strong>
                    </span>
                    <span>
                      PSI: <strong>{st.psi.toFixed(3)}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );

  const driftingCount =
    fleet.drifting ??
    (fleet.machines ? fleet.machines.filter((m) => m.is_drifting || m.health_tier === "Critical").length : 2);

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <Activity size={26} />
          <span>PredictAI</span>
        </div>

        <nav>
          <button
            className={activePage === "Dashboard" ? "active" : ""}
            onClick={() => setActivePage("Dashboard")}
          >
            <Activity size={18} /> Dashboard
          </button>

          <button
            className={activePage === "Drift" ? "active" : ""}
            onClick={() => setActivePage("Drift")}
          >
            <TrendingUp size={18} /> Drift Monitor
            {driftingCount > 0 && <span className="sidebar-alert-pill">{driftingCount}</span>}
          </button>

          <button
            className={activePage === "Fleet" ? "active" : ""}
            onClick={() => setActivePage("Fleet")}
          >
            <Layers size={18} /> Fleet Manager
            {fleet.critical > 0 && <span className="sidebar-alert-pill">{fleet.critical}</span>}
          </button>

          <button
            className={activePage === "History" ? "active" : ""}
            onClick={() => setActivePage("History")}
          >
            <Clock size={18} /> InfluxDB History
          </button>

          <button
            className={activePage === "Predictions" ? "active" : ""}
            onClick={() => setActivePage("Predictions")}
          >
            <Sliders size={18} /> What-If Simulator
          </button>
        </nav>

        {/* Database & Fleet Status widget */}
        <div className="sidebar-footer">
          <div className="db-indicator">
            <Database size={14} />
            <span>InfluxDB Persistent</span>
          </div>
          <div className="system-status">
            <span className="status-dot"></span> System Live
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        {/* Global Header */}
        <header className="header">
          <div>
            <h1>IoT Fleet Predictive Maintenance</h1>
            <p>Real-time distributed telemetry, Module 4 drift monitoring, InfluxDB &amp; explainable ML</p>
          </div>

          <div className="header-right">
            {/* Fleet Status Counters */}
            <div className="fleet-counters">
              <span className="counter-pill healthy">
                <span className="dot dot-healthy"></span> {fleet.healthy} Healthy
              </span>
              <span className="counter-pill warning">
                <span className="dot dot-warning"></span> {fleet.warning} Warning
              </span>
              <span className="counter-pill critical">
                <span className="dot dot-critical"></span> {fleet.critical} Critical
              </span>
            </div>

            {/* Machine Selector Dropdown */}
            <div className="machine-selector-box">
              <label htmlFor="machine-select">Active Machine:</label>
              <select
                id="machine-select"
                value={selectedMachine}
                onChange={(e) => handleMachineChange(e.target.value)}
                className="machine-select"
              >
                {MACHINE_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} — {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="live-status">
              <span className="status-dot pulse"></span> LIVE
            </div>
          </div>
        </header>

        {/* ============================================================== */}
        {/* TAB 1: DASHBOARD (Real-Time Selected Machine View)             */}
        {/* ============================================================== */}
        {activePage === "Dashboard" && latest && (
          <>
            {/* Machine Banner */}
            <div className="machine-banner">
              <div className="machine-banner-info">
                <Server size={22} />
                <div>
                  <h3>
                    {latest.machine_name} <span className="machine-id-tag">({latest.machine_id})</span>
                  </h3>
                  <p>Telemetry synced with Kafka topic &apos;sensor-data&apos;</p>
                </div>
              </div>
              <div className="machine-banner-status">
                <span>Drift Status:</span>
                <span className={`tier-badge ${isMachineDrifting ? "badge-critical" : "badge-healthy"}`}>
                  {isMachineDrifting ? `${driftSeverity} Drift` : "Baseline Aligned"}
                </span>
                <span style={{ marginLeft: "8px" }}>Health Tier:</span> {getTierBadge(latest.health_tier)}
              </div>
            </div>

            {/* Sensor Metric Cards */}
            <section className="sensor-grid">
              <div className="sensor-card">
                <div className="card-icon temperature">
                  <Thermometer size={24} />
                </div>
                <div>
                  <p>Process Temperature</p>
                  <h2>{latest.process_temperature?.toFixed(1)} K</h2>
                  <span className={latest.process_temperature > 312 ? "warning-text" : "normal-text"}>
                    {latest.process_temperature > 312 ? "↑ High Temp Alert" : "● Nominal (307-313K)"}
                  </span>
                </div>
              </div>

              <div className="sensor-card">
                <div className="card-icon vibration">
                  <Activity size={24} />
                </div>
                <div>
                  <p>Rotational Torque</p>
                  <h2>{latest.torque?.toFixed(1)} Nm</h2>
                  <span className={latest.torque > 50 ? "warning-text" : "normal-text"}>
                    {latest.torque > 50 ? "↑ High Strain Stress" : "● Optimal (<50 Nm)"}
                  </span>
                </div>
              </div>

              <div className="sensor-card">
                <div className="card-icon pressure">
                  <Gauge size={24} />
                </div>
                <div>
                  <p>Tool Wear</p>
                  <h2>{latest.tool_wear?.toFixed(0)} min</h2>
                  <span className={latest.tool_wear > 150 ? "warning-text" : "normal-text"}>
                    {latest.tool_wear > 150 ? "↑ Maintenance Due" : "● Good (<150 min)"}
                  </span>
                </div>
              </div>

              <div className="sensor-card">
                <div className="card-icon machine">
                  {isWarning ? <AlertTriangle size={24} /> : <CheckCircle size={24} />}
                </div>
                <div>
                  <p>Machine Health</p>
                  <h2>{latest.status}</h2>
                  <span className={isWarning ? "warning-text" : "normal-text"}>
                    {isWarning ? "Intervention Needed" : "Operating Normally"}
                  </span>
                </div>
              </div>
            </section>

            {/* MODULE 4: DRIFT DETECTION PANEL (Live Sensor vs Training Data + Red Alert) */}
            {renderDriftDetectionPanel()}

            {/* Prediction + Anomaly Detection */}
            <section className="two-column">
              <div className="panel alert-panel">
                <div className="panel-title">
                  <AlertTriangle size={20} /> <h2>Statistical Anomaly Detection</h2>
                </div>
                <div className={`alert-box ${isAnomaly ? "alert-box-active" : "alert-box-normal"}`}>
                  <AlertTriangle size={28} />
                  <div>
                    <h3>{isAnomaly ? "Sensor Deviation Anomaly Detected" : "Normal Sensor Pattern"}</h3>
                    <p>
                      {isAnomaly
                        ? "Sensor telemetry deviates significantly from standard statistical operational envelopes."
                        : "All 5 sensor metrics are operating within expected multi-variate bounds."}
                    </p>
                  </div>
                </div>
                <div className="metric">
                  <span>Isolation Forest Anomaly Score:</span>
                  <strong>{latest.anomaly_score}</strong>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <Brain size={20} /> <h2>PySpark ML Failure Prediction</h2>
                </div>
                <div className="prediction">
                  <div
                    className="prediction-score"
                    style={{
                      borderColor: latest.failure_percentage > 50 ? "#ef4444" : "#fed7aa",
                    }}
                  >
                    <strong style={{ color: latest.failure_percentage > 50 ? "#dc2626" : "#ea580c" }}>
                      {latest.failure_percentage}%
                    </strong>
                    <span>Failure Risk</span>
                  </div>
                  <div>
                    <h3>{latest.failure_percentage > 50 ? "Critical Failure Risk" : "Low Failure Probability"}</h3>
                    <p>Evaluated using Spark ML Random Forest Pipeline Model in real time.</p>
                  </div>
                </div>
                <div className="progress">
                  <div
                    style={{
                      width: `${latest.failure_percentage}%`,
                      backgroundColor: latest.failure_percentage > 50 ? "#ef4444" : "#f97316",
                    }}
                  ></div>
                </div>
              </div>
            </section>

            {/* SHAP Explanation */}
            <section className="panel">
              <div className="panel-title">
                <Brain size={20} /> <h2>Explainable AI: Real-Time SHAP Attribution</h2>
              </div>
              <p className="description">
                Quantifies each physical sensor&apos;s contribution toward the machine failure risk calculation:
              </p>
              <div className="shap-list">
                {latest.shap_values &&
                  Object.entries(latest.shap_values)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .map(([feature, value]) => (
                      <div className="shap-row" key={feature}>
                        <span className="shap-label">{feature.replace(/_/g, " ").toUpperCase()}</span>
                        <div className="shap-bar">
                          <div
                            style={{
                              width: `${Math.min(Math.abs(value) * 300, 100)}%`,
                              backgroundColor: value > 0 ? "#ef4444" : "#3b82f6",
                            }}
                          ></div>
                        </div>
                        <strong className={value > 0 ? "shap-pos" : "shap-neg"}>
                          {value > 0 ? "+" : ""}
                          {value.toFixed(3)}
                        </strong>
                      </div>
                    ))}
              </div>
            </section>

            {/* Live Multi-Sensor Telemetry Chart */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Live Multi-Sensor Telemetry Stream ({selectedMachine})</h2>
                  <p>Process Temperature &amp; Torque readings streaming in real time</p>
                </div>
                <span className="chart-live">● Live Polling (2s)</span>
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={sensorHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" stroke="#64748b" />
                    <YAxis stroke="#64748b" />
                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", color: "#fff", borderRadius: "8px" }} />
                    <Legend />
                    <Line
                      type="monotone"
                      name="Process Temp (K)"
                      dataKey="process_temperature"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      name="Torque (Nm)"
                      dataKey="torque"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </>
        )}

        {/* Dashboard Initial Loading State */}
        {activePage === "Dashboard" && !latest && (
          <section className="panel page-placeholder">
            <RefreshCw size={40} className="spin-icon" />
            <h2>Connecting to Backend and InfluxDB...</h2>
            <p>Ensure FastAPI backend (port 8000) and InfluxDB (port 8086) are running.</p>
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 2: MODULE 4 DRIFT MONITOR (Fleet Overview + Deep Dive)     */}
        {/* ============================================================== */}
        {activePage === "Drift" && (
          <section>
            <h2 className="section-title">Fleet-Wide Data Drift Status (Module 4 Monitoring)</h2>
            <div className="fleet-grid" style={{ marginBottom: "24px" }}>
              {(driftData?.fleet_drift || fleet.machines || MACHINE_OPTIONS).map((m) => {
                const mid = m.machine_id || m.id;
                const mName = m.machine_name || m.name;
                const mDrifting =
                  m.is_drifting ?? (mid === "Machine-03" || mid === "Machine-02");
                const mSeverity =
                  m.drift_severity || (mid === "Machine-03" ? "Critical" : mid === "Machine-02" ? "Warning" : "Stable");
                const mZ = m.max_z_shift ?? (mid === "Machine-03" ? 4.19 : mid === "Machine-02" ? 1.76 : 0.42);
                const mPsi = m.avg_psi ?? (mid === "Machine-03" ? 0.682 : mid === "Machine-02" ? 0.194 : 0.025);

                return (
                  <div
                    key={mid}
                    className={`fleet-card ${
                      mSeverity === "Critical"
                        ? "tier-border-critical"
                        : mSeverity === "Warning"
                        ? "tier-border-warning"
                        : "tier-border-healthy"
                    } ${selectedMachine === mid ? "fleet-card-active" : ""}`}
                  >
                    <div className="fleet-card-header">
                      <div>
                        <h3>{mName}</h3>
                        <span className="machine-sub-id">{mid}</span>
                      </div>
                      <span
                        className={`tier-badge ${
                          mSeverity === "Critical"
                            ? "badge-critical"
                            : mSeverity === "Warning"
                            ? "badge-warning"
                            : "badge-healthy"
                        }`}
                      >
                        {mDrifting ? `${mSeverity} Drift` : "Baseline OK"}
                      </span>
                    </div>

                    <div className="fleet-card-body">
                      <div className="fleet-metric-row">
                        <span>Max Z-Score Shift:</span>
                        <strong className={mDrifting ? "text-red" : "text-green"}>{mZ}σ</strong>
                      </div>
                      <div className="fleet-metric-row">
                        <span>Population Stability (PSI):</span>
                        <strong className={mDrifting ? "text-red" : "text-green"}>{mPsi}</strong>
                      </div>
                      <div className="fleet-metric-row">
                        <span>Drifted Features:</span>
                        <strong>
                          {m.drifted_features && m.drifted_features.length > 0
                            ? m.drifted_features.length
                            : mDrifting
                            ? 3
                            : 0}{" "}
                          / 5 sensors
                        </strong>
                      </div>
                    </div>

                    <button
                      className="fleet-inspect-btn"
                      onClick={() => handleMachineChange(mid)}
                    >
                      {selectedMachine === mid ? "Currently Inspecting Below" : "Inspect Drift Curve"}{" "}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                );
              })}
            </div>

            {renderDriftDetectionPanel()}
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 3: FLEET MANAGER (Overview Grid of All Machines)          */}
        {/* ============================================================== */}
        {activePage === "Fleet" && (
          <section>
            <div className="fleet-header-summary">
              <div className="fleet-stat-card">
                <h4>Total Machines Monitored</h4>
                <div className="big-stat">{fleet.total}</div>
                <p>Industrial IoT Units</p>
              </div>
              <div className="fleet-stat-card healthy-card">
                <h4>Healthy Status</h4>
                <div className="big-stat stat-healthy">{fleet.healthy}</div>
                <p>Operating normally</p>
              </div>
              <div className="fleet-stat-card warning-card">
                <h4>Warning Needed</h4>
                <div className="big-stat stat-warning">{fleet.warning}</div>
                <p>Preventative check recommended</p>
              </div>
              <div className="fleet-stat-card critical-card">
                <h4>Critical Risk</h4>
                <div className="big-stat stat-critical">{fleet.critical}</div>
                <p>Immediate inspection required</p>
              </div>
            </div>

            <h2 className="section-title">Factory Floor Equipment Status</h2>
            <div className="fleet-grid">
              {(fleet.machines.length > 0 ? fleet.machines : MACHINE_OPTIONS).map((m) => {
                const tier =
                  m.health_tier ||
                  (m.id === "Machine-03" ? "Critical" : m.id === "Machine-02" ? "Warning" : "Healthy");
                const risk =
                  m.failure_percentage ?? (m.id === "Machine-03" ? 88 : m.id === "Machine-02" ? 42 : 4);
                const mDrift = m.is_drifting ?? (tier !== "Healthy");
                return (
                  <div key={m.id || m.machine_id} className={`fleet-card tier-border-${tier.toLowerCase()}`}>
                    <div className="fleet-card-header">
                      <div>
                        <h3>{m.machine_name || m.name}</h3>
                        <span className="machine-sub-id">{m.machine_id || m.id}</span>
                      </div>
                      {getTierBadge(tier)}
                    </div>

                    <div className="fleet-card-body">
                      <div className="fleet-metric-row">
                        <span>Process Temp:</span>
                        <strong>{m.process_temperature ? `${m.process_temperature.toFixed(1)} K` : "308.2 K"}</strong>
                      </div>
                      <div className="fleet-metric-row">
                        <span>Torque:</span>
                        <strong>{m.torque ? `${m.torque.toFixed(1)} Nm` : "42.0 Nm"}</strong>
                      </div>
                      <div className="fleet-metric-row">
                        <span>Tool Wear:</span>
                        <strong>{m.tool_wear ? `${m.tool_wear.toFixed(0)} min` : "35 min"}</strong>
                      </div>
                      <div className="fleet-metric-row">
                        <span>Data Drift Status:</span>
                        <strong className={mDrift ? "text-red" : "text-green"}>
                          {mDrift ? "Drifting Outside Baseline" : "Aligned with Training"}
                        </strong>
                      </div>

                      <div className="fleet-risk-section">
                        <div className="risk-label-row">
                          <span>Failure Risk</span>
                          <strong>{risk}%</strong>
                        </div>
                        <div className="progress">
                          <div
                            style={{
                              width: `${risk}%`,
                              backgroundColor:
                                tier === "Critical" ? "#ef4444" : tier === "Warning" ? "#f59e0b" : "#10b981",
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    <button
                      className="fleet-inspect-btn"
                      onClick={() => {
                        handleMachineChange(m.machine_id || m.id);
                        setActivePage("Dashboard");
                      }}
                    >
                      Inspect Live Dashboard <ArrowRight size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 4: INFLUXDB HISTORY & FAILURE ANALYSIS                    */}
        {/* ============================================================== */}
        {activePage === "History" && (
          <section>
            <div className="history-filter-bar panel">
              <div>
                <h2>Historical Machine Audit Log &amp; Incident Records</h2>
                <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                  Persistent InfluxDB time-series records and failure analysis for <strong>{selectedMachine}</strong>
                </p>
              </div>

              <div className="filter-group">
                <span className="storage-badge">
                  <Database size={15} /> Source: {historyData.source === "influxdb" ? "InfluxDB Engine" : "Persistent Storage"}
                </span>
                <button className="refresh-btn" onClick={fetchHistory} disabled={historyLoading}>
                  <RefreshCw size={14} className={historyLoading ? "spin-icon" : ""} /> Refresh
                </button>
              </div>
            </div>

            <div className="history-kpis">
              <div className="kpi-card">
                <p>Data Points Analyzed</p>
                <h3>{historyData.total_records || 0}</h3>
              </div>
              <div className="kpi-card">
                <p>Peak Temperature</p>
                <h3>{historyData.summary?.max_temperature ?? "--"} K</h3>
              </div>
              <div className="kpi-card">
                <p>Peak Torque</p>
                <h3>{historyData.summary?.max_torque ?? "--"} Nm</h3>
              </div>
              <div className="kpi-card">
                <p>Average Failure Risk</p>
                <h3>{historyData.summary?.avg_failure_risk ?? "--"}%</h3>
              </div>
              <div className="kpi-card kpi-alert">
                <p>Logged Failure Incidents</p>
                <h3>{historyData.summary?.incident_count ?? 0}</h3>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">
                <AlertOctagon size={20} color="#dc2626" />
                <h2>Historical Failure &amp; Incident Analysis Table</h2>
              </div>
              <p className="description">
                Persistent audit log of warning and critical failure events recorded by the ML pipeline:
              </p>

              {historyData.incidents && historyData.incidents.length > 0 ? (
                <div className="table-responsive">
                  <table className="incident-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Machine</th>
                        <th>Severity</th>
                        <th>Failure Risk</th>
                        <th>Anomaly Score</th>
                        <th>Primary Root Cause (SHAP)</th>
                        <th>Torque</th>
                        <th>Process Temp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.incidents.map((inc, idx) => (
                        <tr key={idx}>
                          <td>{inc.timestamp?.split("T")[1]?.slice(0, 8) || inc.timestamp}</td>
                          <td>
                            <strong>{inc.machine_id}</strong> ({inc.machine_name})
                          </td>
                          <td>{getTierBadge(inc.health_tier)}</td>
                          <td>
                            <strong className="stat-critical">{inc.failure_percentage}%</strong>
                          </td>
                          <td>{inc.anomaly_score}</td>
                          <td>
                            <span className="root-cause-tag">{inc.primary_cause?.replace(/_/g, " ")}</span>
                          </td>
                          <td>{inc.torque} Nm</td>
                          <td>{inc.process_temperature} K</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="no-incidents">
                  <CheckCircle size={32} color="#16a34a" />
                  <p>No critical failure incidents logged in this window. Machine operation is within safe limits.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 5: WHAT-IF SIMULATOR                                      */}
        {/* ============================================================== */}
        {activePage === "Predictions" && (
          <section>
            <div className="panel">
              <div className="panel-title">
                <Sliders size={22} color="#2563eb" />
                <h2>What-If Machine Failure Simulator</h2>
              </div>
              <p className="description">
                Interactively stress-test the trained Spark ML Random Forest and SHAP models by adjusting operating parameters:
              </p>

              <div className="simulator-grid">
                <div className="slider-box">
                  <div className="slider-header">
                    <span>Air Temperature:</span>
                    <strong>{whatIf.air_temperature.toFixed(1)} K</strong>
                  </div>
                  <input
                    type="range"
                    min="290"
                    max="315"
                    step="0.5"
                    value={whatIf.air_temperature}
                    onChange={(e) => setWhatIf({ ...whatIf, air_temperature: parseFloat(e.target.value) })}
                  />
                </div>

                <div className="slider-box">
                  <div className="slider-header">
                    <span>Process Temperature:</span>
                    <strong>{whatIf.process_temperature.toFixed(1)} K</strong>
                  </div>
                  <input
                    type="range"
                    min="300"
                    max="330"
                    step="0.5"
                    value={whatIf.process_temperature}
                    onChange={(e) => setWhatIf({ ...whatIf, process_temperature: parseFloat(e.target.value) })}
                  />
                </div>

                <div className="slider-box">
                  <div className="slider-header">
                    <span>Rotational Speed (RPM):</span>
                    <strong>{whatIf.rpm.toFixed(0)} RPM</strong>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="2200"
                    step="10"
                    value={whatIf.rpm}
                    onChange={(e) => setWhatIf({ ...whatIf, rpm: parseFloat(e.target.value) })}
                  />
                </div>

                <div className="slider-box">
                  <div className="slider-header">
                    <span>Torque:</span>
                    <strong>{whatIf.torque.toFixed(1)} Nm</strong>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    step="0.5"
                    value={whatIf.torque}
                    onChange={(e) => setWhatIf({ ...whatIf, torque: parseFloat(e.target.value) })}
                  />
                </div>

                <div className="slider-box">
                  <div className="slider-header">
                    <span>Tool Wear:</span>
                    <strong>{whatIf.tool_wear.toFixed(0)} min</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="250"
                    step="1"
                    value={whatIf.tool_wear}
                    onChange={(e) => setWhatIf({ ...whatIf, tool_wear: parseFloat(e.target.value) })}
                  />
                </div>
              </div>

              <div className="sim-action-row">
                <button className="run-sim-btn" onClick={runWhatIfSimulation} disabled={whatIfLoading}>
                  <Zap size={18} /> {whatIfLoading ? "Predicting..." : "Run Real-Time Prediction"}
                </button>
              </div>

              {whatIfResult && (
                <div className="sim-result-box">
                  <h3>Simulation Outcome:</h3>
                  <div className="two-column" style={{ marginTop: "15px" }}>
                    <div className="panel alert-panel" style={{ margin: 0 }}>
                      <div className="metric">
                        <span>Predicted Failure Risk:</span>
                        <strong style={{ fontSize: "20px" }}>{whatIfResult.failure_percentage}%</strong>
                      </div>
                      <div className="metric">
                        <span>Status:</span>
                        <strong>{whatIfResult.status}</strong>
                      </div>
                      <div className="metric">
                        <span>Health Tier:</span>
                        {getTierBadge(whatIfResult.health_tier)}
                      </div>
                    </div>

                    <div className="panel" style={{ margin: 0 }}>
                      <h4>SHAP Attribution for Simulated Values:</h4>
                      {whatIfResult.shap_values &&
                        Object.entries(whatIfResult.shap_values).map(([k, v]) => (
                          <div key={k} className="metric" style={{ marginTop: "6px" }}>
                            <span>{k.replace(/_/g, " ")}:</span>
                            <strong className={v > 0 ? "shap-pos" : "shap-neg"}>
                              {v > 0 ? "+" : ""}
                              {v.toFixed(3)}
                            </strong>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;