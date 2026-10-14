import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Thermometer,
  Gauge,
  AlertTriangle,
  CheckCircle,
  Brain,
  Radio,
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
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
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

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [selectedMachine, setSelectedMachine] = useState("Machine-01");
  const [latest, setLatest] = useState(null);
  const [fleet, setFleet] = useState({ total: 4, healthy: 2, warning: 1, critical: 1, machines: [] });
  const [sensorHistory, setSensorHistory] = useState([]);

  // History Tab States
  const [historyRange, setHistoryRange] = useState("1h");
  const [historyAgg, setHistoryAgg] = useState("raw");
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
    } catch (err) {
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
            torque: data.torque,
            tool_wear: data.tool_wear,
            failure_percentage: data.failure_percentage,
          },
        ];
        return next.length > MAX_LIVE_POINTS ? next.slice(1) : next;
      });
    } catch (err) {
      // Backend temporarily offline
    }
  }, [selectedMachine]);

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

    const fleetInterval = setInterval(fetchFleet, 3000);
    const latestInterval = setInterval(fetchLatest, 2000);

    return () => {
      clearInterval(fleetInterval);
      clearInterval(latestInterval);
    };
  }, [fetchFleet, fetchLatest]);

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
            <p>Real-time distributed telemetry, InfluxDB persistence & explainable ML</p>
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
                <span>Health Tier:</span> {getTierBadge(latest.health_tier)}
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
                    {latest.process_temperature > 312 ? "↑ High Temp Alert" : "● Nominal (300-312K)"}
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

            {/* Live Chart */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Live Sensor Telemetry Stream ({selectedMachine})</h2>
                  <p>Process Temperature & Torque readings streaming in real time</p>
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
        {/* TAB 2: FLEET MANAGER (Overview Grid of All Machines)          */}
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
                const tier = m.health_tier || (m.id === "Machine-03" ? "Critical" : m.id === "Machine-02" ? "Warning" : "Healthy");
                const risk = m.failure_percentage ?? (m.id === "Machine-03" ? 88 : m.id === "Machine-02" ? 42 : 4);
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

                      <div className="fleet-risk-section">
                        <div className="risk-label-row">
                          <span>Failure Risk</span>
                          <strong>{risk}%</strong>
                        </div>
                        <div className="progress">
                          <div
                            style={{
                              width: `${risk}%`,
                              backgroundColor: tier === "Critical" ? "#ef4444" : tier === "Warning" ? "#f59e0b" : "#10b981",
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
        {/* TAB 3: INFLUXDB HISTORY & FAILURE ANALYSIS                    */}
        {/* ============================================================== */}
        {activePage === "History" && (
          <section>
            {/* Clean Header Bar */}
            <div className="history-filter-bar panel">
              <div>
                <h2>Historical Machine Audit Log & Incident Records</h2>
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

            {/* Historical Summary Cards */}
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

            {/* Failure & Incident Analysis Log */}
            <div className="panel">
              <div className="panel-title">
                <AlertOctagon size={20} color="#dc2626" />
                <h2>Historical Failure & Incident Analysis Table</h2>
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
        {/* TAB 4: WHAT-IF SIMULATOR                                      */}
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