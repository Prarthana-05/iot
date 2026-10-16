import sys
import os
import datetime

# Point PySpark directly to the current virtualenv Python
os.environ["PYSPARK_PYTHON"] = sys.executable
os.environ["PYSPARK_DRIVER_PYTHON"] = sys.executable
from collections import defaultdict, deque
from typing import Optional, List
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pyspark.sql import SparkSession
from pyspark.ml import PipelineModel
import joblib
import numpy as np
import shap

app = FastAPI(title="IoT Predictive Maintenance & Fleet Management API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "predictive_maintenance_model")
SHAP_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "shap_explainer_model.pkl")
ANOMALY_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "anomaly_detection_model.pkl")

FEATURE_NAMES = ["air_temperature", "process_temperature", "rpm", "torque", "tool_wear"]

# Spark Session initialization
spark = SparkSession.builder \
    .appName("PredictiveMaintenanceAPI") \
    .master("local[*]") \
    .getOrCreate()

spark.sparkContext.setLogLevel("WARN")

print("Loading predictive maintenance model...")
model = PipelineModel.load(MODEL_PATH)
print("✅ Spark model loaded successfully!")

print("Loading SHAP explainer model...")
shap_model = joblib.load(SHAP_MODEL_PATH)
explainer = shap.TreeExplainer(shap_model)
print("✅ SHAP explainer ready!")

print("Loading anomaly detection model...")
anomaly_artifact = joblib.load(ANOMALY_MODEL_PATH)
anomaly_model = anomaly_artifact["model"]
anomaly_scaler = anomaly_artifact["scaler"]
anomaly_threshold = anomaly_artifact["threshold"]
print(f"✅ Anomaly model ready! (threshold={anomaly_threshold}, ROC-AUC={anomaly_artifact.get('roc_auc')})")

# Training Data Baseline Profile (Module 4 Drift Monitoring Reference)
DEFAULT_BASELINE = {
    "air_temperature": {"mean": 300.0, "std": 2.0, "unit": "K", "label": "Air Temperature"},
    "process_temperature": {"mean": 310.0, "std": 1.48, "unit": "K", "label": "Process Temperature"},
    "rpm": {"mean": 1538.8, "std": 179.3, "unit": "RPM", "label": "Rotational Speed"},
    "torque": {"mean": 40.0, "std": 9.97, "unit": "Nm", "label": "Rotational Torque"},
    "tool_wear": {"mean": 108.0, "std": 63.65, "unit": "min", "label": "Tool Wear"},
}

TRAINING_BASELINE = {}
scaler_means = getattr(anomaly_scaler, "mean_", None)
scaler_scales = getattr(anomaly_scaler, "scale_", None)

for idx, feat in enumerate(FEATURE_NAMES):
    meta = DEFAULT_BASELINE[feat]
    f_mean = float(scaler_means[idx]) if scaler_means is not None and len(scaler_means) > idx else meta["mean"]
    f_std = float(scaler_scales[idx]) if scaler_scales is not None and len(scaler_scales) > idx and scaler_scales[idx] > 0 else meta["std"]
    TRAINING_BASELINE[feat] = {
        "feature": feat,
        "label": meta["label"],
        "unit": meta["unit"],
        "mean": round(f_mean, 2),
        "std": round(f_std, 2),
        "lower_2sigma": round(f_mean - 2.0 * f_std, 2),
        "upper_2sigma": round(f_mean + 2.0 * f_std, 2),
    }

# InfluxDB Configuration
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://localhost:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "iot-super-secret-token-12345")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "iot_org")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "sensor_data")

influx_client = None
write_api = None
query_api = None


def get_influx_client():
    global influx_client, write_api, query_api
    if influx_client is None:
        try:
            from influxdb_client import InfluxDBClient
            from influxdb_client.client.write_api import SYNCHRONOUS
            influx_client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG, timeout=1000)
            write_api = influx_client.write_api(write_options=SYNCHRONOUS)
            query_api = influx_client.query_api()
            print(f"✅ InfluxDB connected at {INFLUXDB_URL}")
        except Exception as e:
            pass
    return influx_client


class SensorData(BaseModel):
    machine_id: str = "Machine-01"
    machine_name: Optional[str] = None
    air_temperature: float
    process_temperature: float
    rpm: float
    torque: float
    tool_wear: float


class DriftSimulationRequest(BaseModel):
    machine_id: str = "Machine-01"
    mode: str = "drift"  # "drift" or "reset"


MACHINE_NAMES = {
    "Machine-01": "CNC Milling Alpha",
    "Machine-02": "Lathe Pro-X",
    "Machine-03": "Heavy Stamping Unit",
    "Machine-04": "Robotic Drill Rig"
}

# In-memory historical buffer (fast fallback & immediate reactivity)
historical_buffer = defaultdict(lambda: deque(maxlen=1000))
incident_log = deque(maxlen=200)


def compute_drift(machine_id: str, current_values: dict) -> dict:
    """
    Module 4 Data & Covariate Drift Detection Engine.
    Compares live sensor window against AI4I 2020 training baseline (mean, 2-sigma envelope, PSI & Z-shift).
    """
    recent_records = list(historical_buffer[machine_id])[-20:]
    feature_drift = {}
    drifted_features = []
    severe_features = []
    psi_values = []
    z_shifts = []

    for feat in FEATURE_NAMES:
        base = TRAINING_BASELINE[feat]
        t_mean = base["mean"]
        t_std = max(base["std"], 1e-5)

        cur_val = float(current_values.get(feat, t_mean))
        window_vals = [float(r[feat]) for r in recent_records if feat in r and r[feat] is not None]
        # Weight recent readings so sudden drift or recovery is immediately reflected
        recent_tail = window_vals[-6:] + [cur_val, cur_val]
        live_mean = float(np.mean(recent_tail))
        live_std = float(np.std(window_vals + [cur_val])) if len(window_vals) >= 3 else t_std * 0.85
        live_std = max(live_std, t_std * 0.25)

        instant_z = abs(cur_val - t_mean) / t_std
        window_z = abs(live_mean - t_mean) / t_std
        effective_z = round(float(max(window_z, instant_z * 0.9)), 2)
        signed_z = round(float((cur_val - t_mean) / t_std), 2)

        # Gaussian PSI / KL-Divergence symmetric approximation between Training and Live distributions
        var_ratio = (live_std ** 2) / (t_std ** 2)
        mean_diff_sq = ((live_mean - t_mean) ** 2) / (t_std ** 2)
        psi_raw = 0.5 * (mean_diff_sq + var_ratio - 1.0 - np.log(max(var_ratio, 1e-6)))
        psi = round(float(max(0.0, psi_raw)), 3)

        if effective_z >= 2.2 or psi >= 0.25:
            f_status = "Severe Drift"
            drifted_features.append(feat)
            severe_features.append(feat)
        elif effective_z >= 1.5 or psi >= 0.12:
            f_status = "Moderate Drift"
            drifted_features.append(feat)
        else:
            f_status = "Stable"

        psi_values.append(psi)
        z_shifts.append(effective_z)

        feature_drift[feat] = {
            "feature": feat,
            "label": base["label"],
            "unit": base["unit"],
            "train_mean": t_mean,
            "train_std": t_std,
            "train_lower": base["lower_2sigma"],
            "train_upper": base["upper_2sigma"],
            "live_current": round(cur_val, 2),
            "live_mean": round(live_mean, 2),
            "live_std": round(live_std, 2),
            "z_shift": effective_z,
            "signed_z": signed_z,
            "psi": psi,
            "is_outside_band": bool(cur_val < base["lower_2sigma"] or cur_val > base["upper_2sigma"]),
            "status": f_status,
        }

    max_z = max(z_shifts) if z_shifts else 0.0
    avg_psi = round(float(np.mean(psi_values)), 3) if psi_values else 0.0
    drift_score = round(min(100.0, (max_z / 3.5) * 100.0), 1)

    if len(severe_features) >= 1 or max_z >= 2.2:
        drift_severity = "Critical"
        is_drifting = True
    elif len(drifted_features) >= 1 or max_z >= 1.5:
        drift_severity = "Warning"
        is_drifting = True
    else:
        drift_severity = "Stable"
        is_drifting = False

    if drift_severity == "Critical":
        top_feats = ", ".join(
            f"{feature_drift[f]['label']} ({feature_drift[f]['signed_z']:+.1f}σ)"
            for f in (severe_features or drifted_features)[:3]
        )
        alert_message = (
            f"CRITICAL DATA DRIFT ALERT: Live sensor distribution for {top_feats} has shifted "
            f"outside the AI4I training baseline (Max Shift: {max_z:.2f}σ, PSI: {avg_psi:.3f}). "
            f"Model retraining or sensor recalibration required."
        )
    elif drift_severity == "Warning":
        top_feats = ", ".join(
            f"{feature_drift[f]['label']} ({feature_drift[f]['signed_z']:+.1f}σ)"
            for f in drifted_features[:3]
        )
        alert_message = (
            f"MODERATE DRIFT WARNING: Gradual covariate shift observed in {top_feats} "
            f"(Max Shift: {max_z:.2f}σ, PSI: {avg_psi:.3f}). Monitor closely for distribution divergence."
        )
    else:
        alert_message = (
            "All 5 live sensor distributions align with the AI4I 2020 training dataset baseline "
            "(within ±2σ operational envelope)."
        )

    return {
        "is_drifting": is_drifting,
        "drift_severity": drift_severity,
        "drift_score": drift_score,
        "max_z_shift": round(max_z, 2),
        "avg_psi": avg_psi,
        "drifted_features": drifted_features,
        "severe_features": severe_features,
        "alert_message": alert_message,
        "features": feature_drift,
    }


# Pre-populated fleet demo data so the dashboard immediately shows vivid fleet health & drift trajectories
base_now = datetime.datetime.now()
fleet_status = {
    "Machine-01": {
        "machine_id": "Machine-01",
        "machine_name": "CNC Milling Alpha",
        "status": "NORMAL",
        "health_tier": "Healthy",
        "prediction": 0,
        "failure_probability": 0.04,
        "failure_percentage": 4.0,
        "air_temperature": 299.6,
        "process_temperature": 309.8,
        "rpm": 1525.0,
        "torque": 39.8,
        "tool_wear": 85.0,
        "shap_values": {"air_temperature": 0.01, "process_temperature": 0.02, "rpm": -0.01, "torque": 0.03, "tool_wear": 0.01},
        "is_anomaly": False,
        "anomaly_score": -0.12,
        "timestamp": base_now.isoformat(),
    },
    "Machine-02": {
        "machine_id": "Machine-02",
        "machine_name": "Lathe Pro-X",
        "status": "NORMAL",
        "health_tier": "Warning",
        "prediction": 0,
        "failure_probability": 0.42,
        "failure_percentage": 42.0,
        "air_temperature": 302.6,
        "process_temperature": 312.6,
        "rpm": 1365.0,
        "torque": 55.8,
        "tool_wear": 182.0,
        "shap_values": {"air_temperature": 0.04, "process_temperature": 0.15, "rpm": -0.02, "torque": 0.18, "tool_wear": 0.22},
        "is_anomaly": False,
        "anomaly_score": 0.15,
        "timestamp": base_now.isoformat(),
    },
    "Machine-03": {
        "machine_id": "Machine-03",
        "machine_name": "Heavy Stamping Unit",
        "status": "FAILURE RISK",
        "health_tier": "Critical",
        "prediction": 1,
        "failure_probability": 0.88,
        "failure_percentage": 88.0,
        "air_temperature": 305.4,
        "process_temperature": 316.2,
        "rpm": 1190.0,
        "torque": 68.4,
        "tool_wear": 225.0,
        "shap_values": {"air_temperature": 0.08, "process_temperature": 0.28, "rpm": -0.05, "torque": 0.35, "tool_wear": 0.42},
        "is_anomaly": True,
        "anomaly_score": 0.84,
        "timestamp": base_now.isoformat(),
    },
    "Machine-04": {
        "machine_id": "Machine-04",
        "machine_name": "Robotic Drill Rig",
        "status": "NORMAL",
        "health_tier": "Healthy",
        "prediction": 0,
        "failure_probability": 0.02,
        "failure_percentage": 2.0,
        "air_temperature": 299.2,
        "process_temperature": 309.4,
        "rpm": 1550.0,
        "torque": 38.4,
        "tool_wear": 72.0,
        "shap_values": {"air_temperature": -0.01, "process_temperature": 0.01, "rpm": 0.0, "torque": 0.01, "tool_wear": 0.0},
        "is_anomaly": False,
        "anomaly_score": -0.25,
        "timestamp": base_now.isoformat(),
    }
}

# Seed realistic 12-point historical trajectory per machine so live & drift charts render rich curves immediately
rng = np.random.default_rng(42)
for mid, mdata in fleet_status.items():
    for step_idx in range(12):
        progress = (step_idx + 1) / 12.0
        pt_time = (base_now - datetime.timedelta(seconds=(11 - step_idx) * 2)).isoformat()
        if mid == "Machine-03":
            # Progressive drift curve from nominal toward severe drift
            sim_pt = {
                **mdata,
                "air_temperature": round(300.5 + progress * (mdata["air_temperature"] - 300.5) + float(rng.normal(0, 0.2)), 2),
                "process_temperature": round(310.4 + progress * (mdata["process_temperature"] - 310.4) + float(rng.normal(0, 0.25)), 2),
                "rpm": round(1490.0 + progress * (mdata["rpm"] - 1490.0) + float(rng.normal(0, 12)), 1),
                "torque": round(43.0 + progress * (mdata["torque"] - 43.0) + float(rng.normal(0, 1.1)), 2),
                "tool_wear": round(140.0 + progress * (mdata["tool_wear"] - 140.0), 1),
                "timestamp": pt_time,
            }
        elif mid == "Machine-02":
            sim_pt = {
                **mdata,
                "air_temperature": round(300.2 + progress * (mdata["air_temperature"] - 300.2) + float(rng.normal(0, 0.2)), 2),
                "process_temperature": round(310.2 + progress * (mdata["process_temperature"] - 310.2) + float(rng.normal(0, 0.2)), 2),
                "rpm": round(1510.0 + progress * (mdata["rpm"] - 1510.0) + float(rng.normal(0, 10)), 1),
                "torque": round(42.0 + progress * (mdata["torque"] - 42.0) + float(rng.normal(0, 0.9)), 2),
                "tool_wear": round(125.0 + progress * (mdata["tool_wear"] - 125.0), 1),
                "timestamp": pt_time,
            }
        else:
            sim_pt = {
                **mdata,
                "air_temperature": round(mdata["air_temperature"] + float(rng.normal(0, 0.35)), 2),
                "process_temperature": round(mdata["process_temperature"] + float(rng.normal(0, 0.3)), 2),
                "rpm": round(mdata["rpm"] + float(rng.normal(0, 18)), 1),
                "torque": round(mdata["torque"] + float(rng.normal(0, 1.5)), 2),
                "tool_wear": round(max(10.0, mdata["tool_wear"] - (11 - step_idx) * 0.5), 1),
                "timestamp": pt_time,
            }
        historical_buffer[mid].append(sim_pt)

    # Compute initial drift state and attach to fleet_status and last buffer item
    drift_info = compute_drift(mid, mdata)
    mdata["drift"] = drift_info
    mdata["is_drifting"] = drift_info["is_drifting"]
    mdata["drift_severity"] = drift_info["drift_severity"]
    mdata["drift_score"] = drift_info["drift_score"]
    historical_buffer[mid][-1] = mdata

    if mdata["health_tier"] in ("Warning", "Critical"):
        incident_log.append({
            "timestamp": mdata["timestamp"],
            "machine_id": mid,
            "machine_name": mdata["machine_name"],
            "health_tier": mdata["health_tier"],
            "failure_percentage": mdata["failure_percentage"],
            "anomaly_score": mdata["anomaly_score"],
            "primary_cause": max(mdata["shap_values"].items(), key=lambda x: abs(x[1]))[0],
            "torque": mdata["torque"],
            "process_temperature": mdata["process_temperature"],
            "tool_wear": mdata["tool_wear"]
        })


def compute_shap(data: SensorData):
    try:
        X = np.array([[data.air_temperature, data.process_temperature, data.rpm, data.torque, data.tool_wear]])
        shap_vals = explainer.shap_values(X)
        arr = np.array(shap_vals, dtype=object) if isinstance(shap_vals, list) else np.array(shap_vals)

        if isinstance(shap_vals, list):
            values = np.ravel(np.array(shap_vals[1]))
        elif arr.ndim == 3:
            values = arr[0, :, 1]
        elif arr.ndim == 2:
            values = arr[0]
        else:
            values = np.ravel(arr)

        return {name: round(float(val), 4) for name, val in zip(FEATURE_NAMES, values)}
    except Exception as e:
        print(f"SHAP computation failed: {e}")
        return {name: 0.0 for name in FEATURE_NAMES}


def compute_anomaly(data: SensorData):
    try:
        X = np.array([[data.air_temperature, data.process_temperature, data.rpm, data.torque, data.tool_wear]])
        X_scaled = anomaly_scaler.transform(X)

        score = -anomaly_model.decision_function(X_scaled)[0]
        is_anomaly = bool(score >= anomaly_threshold)

        return is_anomaly, round(float(score), 4)
    except Exception as e:
        print(f"Anomaly computation failed: {e}")
        return False, 0.0


def run_prediction(data: SensorData):
    input_data = spark.createDataFrame(
        [(data.air_temperature, data.process_temperature, data.rpm, data.torque, data.tool_wear)],
        FEATURE_NAMES
    )
    prediction = model.transform(input_data)
    result = prediction.select("prediction", "probability").collect()[0]

    predicted_class = int(result["prediction"])
    failure_probability = float(result["probability"][1])
    status = "FAILURE RISK" if predicted_class == 1 else "NORMAL"

    shap_values = compute_shap(data)
    is_anomaly, anomaly_score = compute_anomaly(data)

    current_vals = {
        "air_temperature": round(data.air_temperature, 2),
        "process_temperature": round(data.process_temperature, 2),
        "rpm": round(data.rpm, 2),
        "torque": round(data.torque, 2),
        "tool_wear": round(data.tool_wear, 2),
    }
    drift_info = compute_drift(data.machine_id, current_vals)

    # Classify multi-tier health
    if predicted_class == 1 or failure_probability >= 0.70 or drift_info["drift_severity"] == "Critical":
        health_tier = "Critical"
    elif failure_probability >= 0.35 or is_anomaly or data.torque > 50 or data.process_temperature > 312 or drift_info["is_drifting"]:
        health_tier = "Warning"
    else:
        health_tier = "Healthy"

    machine_name = data.machine_name or MACHINE_NAMES.get(data.machine_id, data.machine_id)

    return {
        "machine_id": data.machine_id,
        "machine_name": machine_name,
        "prediction": predicted_class,
        "status": status,
        "health_tier": health_tier,
        "failure_probability": round(failure_probability, 4),
        "failure_percentage": round(failure_probability * 100, 2),
        "air_temperature": current_vals["air_temperature"],
        "process_temperature": current_vals["process_temperature"],
        "rpm": current_vals["rpm"],
        "torque": current_vals["torque"],
        "tool_wear": current_vals["tool_wear"],
        "shap_values": shap_values,
        "is_anomaly": is_anomaly,
        "anomaly_score": anomaly_score,
        "is_drifting": drift_info["is_drifting"],
        "drift_severity": drift_info["drift_severity"],
        "drift_score": drift_info["drift_score"],
        "drift": drift_info,
        "timestamp": datetime.datetime.now().isoformat(),
    }


def write_to_influx(record: dict):
    get_influx_client()
    if write_api is None:
        return
    try:
        from influxdb_client import Point, WritePrecision
        point = (
            Point("sensor_telemetry")
            .tag("machine_id", record["machine_id"])
            .tag("health_tier", record["health_tier"])
            .tag("status", record["status"])
            .field("air_temperature", float(record["air_temperature"]))
            .field("process_temperature", float(record["process_temperature"]))
            .field("rpm", float(record["rpm"]))
            .field("torque", float(record["torque"]))
            .field("tool_wear", float(record["tool_wear"]))
            .field("failure_probability", float(record["failure_probability"]))
            .field("failure_percentage", float(record["failure_percentage"]))
            .field("anomaly_score", float(record["anomaly_score"]))
            .field("prediction", int(record["prediction"]))
            .field("is_anomaly", int(1 if record["is_anomaly"] else 0))
            .time(datetime.datetime.utcnow(), WritePrecision.NS)
        )
        write_api.write(bucket=INFLUXDB_BUCKET, org=INFLUXDB_ORG, record=point)
    except Exception:
        pass


@app.get("/")
def home():
    return {
        "message": "IoT Predictive Maintenance & Fleet Management API",
        "model": "Random Forest + SHAP + Anomaly Detection",
        "storage": "InfluxDB Time-Series",
        "status": "running"
    }


@app.get("/fleet")
def get_fleet():
    machines = list(fleet_status.values())
    healthy_count = sum(1 for m in machines if m.get("health_tier") == "Healthy")
    warning_count = sum(1 for m in machines if m.get("health_tier") == "Warning")
    critical_count = sum(1 for m in machines if m.get("health_tier") == "Critical")
    drifting_count = sum(1 for m in machines if m.get("is_drifting"))

    return {
        "total": len(machines),
        "healthy": healthy_count,
        "warning": warning_count,
        "critical": critical_count,
        "drifting": drifting_count,
        "machines": machines
    }


@app.post("/predict")
def predict(data: SensorData):
    return run_prediction(data)


@app.post("/ingest")
def ingest(data: SensorData):
    result = run_prediction(data)
    fleet_status[data.machine_id] = result
    historical_buffer[data.machine_id].append(result)

    if result["health_tier"] in ("Warning", "Critical"):
        primary_cause = max(result["shap_values"].items(), key=lambda x: abs(x[1]))[0] if result["shap_values"] else "unknown"
        incident_log.appendleft({
            "timestamp": result["timestamp"],
            "machine_id": data.machine_id,
            "machine_name": result["machine_name"],
            "health_tier": result["health_tier"],
            "failure_percentage": result["failure_percentage"],
            "anomaly_score": result["anomaly_score"],
            "primary_cause": primary_cause,
            "torque": result["torque"],
            "process_temperature": result["process_temperature"],
            "tool_wear": result["tool_wear"]
        })

    # Persist asynchronously / synchronously to InfluxDB
    write_to_influx(result)

    return {"status": "ingested", "machine_id": data.machine_id, "health_tier": result["health_tier"], "is_drifting": result["is_drifting"]}


@app.get("/latest")
def get_latest(machine_id: Optional[str] = Query(None)):
    if machine_id and machine_id in fleet_status:
        return fleet_status[machine_id]
    if fleet_status:
        return list(fleet_status.values())[0]
    return {"status": "WAITING"}


@app.get("/drift")
def get_drift(
    machine_id: str = Query("Machine-01"),
    feature: str = Query("process_temperature")
):
    """
    Module 4 Data & Covariate Drift Monitoring Endpoint.
    Returns live sensor telemetry vs. AI4I 2020 training baseline (mean & ±2σ band),
    per-feature PSI & Z-score metrics, and fleet-wide drift status.
    """
    if machine_id not in fleet_status:
        machine_id = "Machine-01"
    if feature not in FEATURE_NAMES:
        feature = "process_temperature"

    current_record = fleet_status[machine_id]
    drift_info = current_record.get("drift") or compute_drift(machine_id, current_record)

    # Build time-series comparison ("Sensor Data vs. Training Data") for the selected machine
    buf_items = list(historical_buffer[machine_id])[-25:]
    comparison_series = []
    for item in buf_items:
        t_raw = item.get("timestamp", "")
        t_str = t_raw.split("T")[-1][:8] if "T" in t_raw else str(t_raw)
        pt = {"time": t_str}
        for feat in FEATURE_NAMES:
            base = TRAINING_BASELINE[feat]
            val = float(item.get(feat, base["mean"]))
            pt[feat] = round(val, 2)
            pt[f"{feat}_train_mean"] = base["mean"]
            pt[f"{feat}_train_lower"] = base["lower_2sigma"]
            pt[f"{feat}_train_upper"] = base["upper_2sigma"]
            pt[f"{feat}_train_band"] = [base["lower_2sigma"], base["upper_2sigma"]]
        comparison_series.append(pt)

    fleet_drift = []
    for mid, mrec in fleet_status.items():
        mdrift = mrec.get("drift") or compute_drift(mid, mrec)
        fleet_drift.append({
            "machine_id": mid,
            "machine_name": mrec.get("machine_name", mid),
            "is_drifting": mdrift["is_drifting"],
            "drift_severity": mdrift["drift_severity"],
            "drift_score": mdrift["drift_score"],
            "max_z_shift": mdrift["max_z_shift"],
            "avg_psi": mdrift["avg_psi"],
            "drifted_features": mdrift["drifted_features"],
        })

    return {
        "machine_id": machine_id,
        "machine_name": current_record.get("machine_name", machine_id),
        "selected_feature": feature,
        "training_baseline": TRAINING_BASELINE,
        "drift": drift_info,
        "comparison_series": comparison_series,
        "fleet_drift": fleet_drift,
    }


@app.post("/drift/simulate")
def simulate_drift(req: DriftSimulationRequest):
    """
    Injects or resets covariate sensor drift on a target machine so users can
    immediately observe live 'Sensor Data vs. Training Data' divergence and Red Drift Alerts.
    """
    mid = req.machine_id if req.machine_id in MACHINE_NAMES else "Machine-01"
    prev = fleet_status.get(mid, fleet_status["Machine-01"])
    now = datetime.datetime.now()

    if req.mode == "reset":
        target = SensorData(
            machine_id=mid,
            machine_name=MACHINE_NAMES.get(mid, mid),
            air_temperature=round(TRAINING_BASELINE["air_temperature"]["mean"] + 0.2, 2),
            process_temperature=round(TRAINING_BASELINE["process_temperature"]["mean"] + 0.1, 2),
            rpm=round(TRAINING_BASELINE["rpm"]["mean"] - 10.0, 1),
            torque=round(TRAINING_BASELINE["torque"]["mean"] - 0.5, 2),
            tool_wear=65.0,
        )
    else:
        # Dramatic covariate shift outside the +2σ training envelope
        target = SensorData(
            machine_id=mid,
            machine_name=MACHINE_NAMES.get(mid, mid),
            air_temperature=round(TRAINING_BASELINE["air_temperature"]["mean"] + 3.1 * TRAINING_BASELINE["air_temperature"]["std"], 2),
            process_temperature=round(TRAINING_BASELINE["process_temperature"]["mean"] + 3.8 * TRAINING_BASELINE["process_temperature"]["std"], 2),
            rpm=round(TRAINING_BASELINE["rpm"]["mean"] - 2.3 * TRAINING_BASELINE["rpm"]["std"], 1),
            torque=round(TRAINING_BASELINE["torque"]["mean"] + 2.9 * TRAINING_BASELINE["torque"]["std"], 2),
            tool_wear=228.0,
        )

    # Append 6 progressive transition steps into historical_buffer for a smooth visual ramp
    steps = 6
    for i in range(1, steps):
        alpha = i / float(steps)
        step_time = (now - datetime.timedelta(seconds=(steps - i) * 2)).isoformat()
        historical_buffer[mid].append({
            **prev,
            "air_temperature": round(prev["air_temperature"] + alpha * (target.air_temperature - prev["air_temperature"]), 2),
            "process_temperature": round(prev["process_temperature"] + alpha * (target.process_temperature - prev["process_temperature"]), 2),
            "rpm": round(prev["rpm"] + alpha * (target.rpm - prev["rpm"]), 1),
            "torque": round(prev["torque"] + alpha * (target.torque - prev["torque"]), 2),
            "tool_wear": round(prev["tool_wear"] + alpha * (target.tool_wear - prev["tool_wear"]), 1),
            "timestamp": step_time,
        })

    result = run_prediction(target)
    fleet_status[mid] = result
    historical_buffer[mid].append(result)

    if result["health_tier"] in ("Warning", "Critical"):
        primary_cause = max(result["shap_values"].items(), key=lambda x: abs(x[1]))[0] if result["shap_values"] else "process_temperature"
        incident_log.appendleft({
            "timestamp": result["timestamp"],
            "machine_id": mid,
            "machine_name": result["machine_name"],
            "health_tier": result["health_tier"],
            "failure_percentage": result["failure_percentage"],
            "anomaly_score": result["anomaly_score"],
            "primary_cause": primary_cause,
            "torque": result["torque"],
            "process_temperature": result["process_temperature"],
            "tool_wear": result["tool_wear"],
        })

    return {
        "status": "simulated",
        "mode": req.mode,
        "machine_id": mid,
        "latest": result,
    }


@app.get("/history")
def get_history(
    machine_id: Optional[str] = Query(None),
    time_range: str = Query("1h", alias="range"),
    aggregation: str = Query("raw")
):
    """
    Queries historical time-series data from InfluxDB with aggregation support,
    falling back to circular in-memory buffer if InfluxDB is offline.
    """
    records = []
    source = "influxdb"

    get_influx_client()
    if query_api:
        try:
            flux_range_map = {"15m": "-15m", "1h": "-1h", "6h": "-6h", "24h": "-24h", "7d": "-7d"}
            range_val = flux_range_map.get(time_range, "-1h")

            machine_filter = f'|> filter(fn: (r) => r["machine_id"] == "{machine_id}")' if machine_id else ''

            window_map = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h"}
            agg_window = window_map.get(aggregation, "")

            if agg_window:
                query = f'''
                from(bucket: "{INFLUXDB_BUCKET}")
                  |> range(start: {range_val})
                  |> filter(fn: (r) => r["_measurement"] == "sensor_telemetry")
                  {machine_filter}
                  |> aggregateWindow(every: {agg_window}, fn: mean, createEmpty: false)
                  |> yield(name: "mean")
                '''
            else:
                query = f'''
                from(bucket: "{INFLUXDB_BUCKET}")
                  |> range(start: {range_val})
                  |> filter(fn: (r) => r["_measurement"] == "sensor_telemetry")
                  {machine_filter}
                  |> limit(n: 500)
                '''

            tables = query_api.query(query, org=INFLUXDB_ORG)
            
            # Pivot flux rows into timestamp-grouped items
            grouped_by_time = defaultdict(dict)
            for table in tables:
                for record in table.records:
                    t_str = record.get_time().strftime("%H:%M:%S")
                    grouped_by_time[t_str][record.get_field()] = record.get_value()
                    grouped_by_time[t_str]["machine_id"] = record.values.get("machine_id", machine_id)
                    grouped_by_time[t_str]["time"] = t_str

            records = list(grouped_by_time.values())
        except Exception as e:
            source = "in-memory-fallback"
    else:
        source = "in-memory-fallback"

    # Fallback to in-memory circular history buffer if InfluxDB yielded no records
    if not records:
        source = "in-memory-fallback"
        buf = []
        if machine_id and machine_id in historical_buffer:
            buf = list(historical_buffer[machine_id])
        else:
            for m_records in historical_buffer.values():
                buf.extend(list(m_records))
            buf.sort(key=lambda x: x.get("timestamp", ""))

        for item in buf[-100:]:
            t_obj = item.get("timestamp")
            t_formatted = t_obj.split("T")[-1][:8] if t_obj and "T" in t_obj else str(t_obj)
            records.append({
                "time": t_formatted,
                "machine_id": item.get("machine_id"),
                "process_temperature": item.get("process_temperature"),
                "air_temperature": item.get("air_temperature"),
                "rpm": item.get("rpm"),
                "torque": item.get("torque"),
                "tool_wear": item.get("tool_wear"),
                "failure_percentage": item.get("failure_percentage"),
                "anomaly_score": item.get("anomaly_score"),
                "health_tier": item.get("health_tier"),
            })

    # Filter incidents for selected machine
    matching_incidents = [
        inc for inc in incident_log
        if not machine_id or inc["machine_id"] == machine_id
    ]

    # Calculate summary metrics
    temps = [r.get("process_temperature", 0) for r in records if r.get("process_temperature")]
    torques = [r.get("torque", 0) for r in records if r.get("torque")]
    risks = [r.get("failure_percentage", 0) for r in records if r.get("failure_percentage") is not None]

    return {
        "machine_id": machine_id or "All Machines",
        "time_range": time_range,
        "aggregation": aggregation,
        "source": source,
        "total_records": len(records),
        "summary": {
            "max_temperature": round(max(temps), 1) if temps else 0,
            "avg_temperature": round(sum(temps)/len(temps), 1) if temps else 0,
            "max_torque": round(max(torques), 1) if torques else 0,
            "avg_failure_risk": round(sum(risks)/len(risks), 1) if risks else 0,
            "incident_count": len(matching_incidents)
        },
        "series": records,
        "incidents": matching_incidents
    }