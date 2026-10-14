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


MACHINE_NAMES = {
    "Machine-01": "CNC Milling Alpha",
    "Machine-02": "Lathe Pro-X",
    "Machine-03": "Heavy Stamping Unit",
    "Machine-04": "Robotic Drill Rig"
}

# In-memory historical buffer (fast fallback & immediate reactivity)
historical_buffer = defaultdict(lambda: deque(maxlen=1000))
incident_log = deque(maxlen=200)

# Pre-populated fleet demo data so the dashboard immediately shows vivid fleet health
now_iso = datetime.datetime.now().isoformat()
fleet_status = {
    "Machine-01": {
        "machine_id": "Machine-01",
        "machine_name": "CNC Milling Alpha",
        "status": "NORMAL",
        "health_tier": "Healthy",
        "prediction": 0,
        "failure_probability": 0.04,
        "failure_percentage": 4.0,
        "air_temperature": 298.2,
        "process_temperature": 308.7,
        "rpm": 1500.0,
        "torque": 40.2,
        "tool_wear": 25.0,
        "shap_values": {"air_temperature": 0.01, "process_temperature": 0.02, "rpm": -0.01, "torque": 0.03, "tool_wear": 0.01},
        "is_anomaly": False,
        "anomaly_score": -0.12,
        "timestamp": now_iso,
    },
    "Machine-02": {
        "machine_id": "Machine-02",
        "machine_name": "Lathe Pro-X",
        "status": "NORMAL",
        "health_tier": "Warning",
        "prediction": 0,
        "failure_probability": 0.42,
        "failure_percentage": 42.0,
        "air_temperature": 302.1,
        "process_temperature": 313.4,
        "rpm": 1380.0,
        "torque": 52.8,
        "tool_wear": 162.0,
        "shap_values": {"air_temperature": 0.04, "process_temperature": 0.15, "rpm": -0.02, "torque": 0.18, "tool_wear": 0.22},
        "is_anomaly": False,
        "anomaly_score": 0.15,
        "timestamp": now_iso,
    },
    "Machine-03": {
        "machine_id": "Machine-03",
        "machine_name": "Heavy Stamping Unit",
        "status": "FAILURE RISK",
        "health_tier": "Critical",
        "prediction": 1,
        "failure_probability": 0.88,
        "failure_percentage": 88.0,
        "air_temperature": 304.5,
        "process_temperature": 318.9,
        "rpm": 1220.0,
        "torque": 68.4,
        "tool_wear": 215.0,
        "shap_values": {"air_temperature": 0.08, "process_temperature": 0.28, "rpm": -0.05, "torque": 0.35, "tool_wear": 0.42},
        "is_anomaly": True,
        "anomaly_score": 0.84,
        "timestamp": now_iso,
    },
    "Machine-04": {
        "machine_id": "Machine-04",
        "machine_name": "Robotic Drill Rig",
        "status": "NORMAL",
        "health_tier": "Healthy",
        "prediction": 0,
        "failure_probability": 0.02,
        "failure_percentage": 2.0,
        "air_temperature": 296.8,
        "process_temperature": 306.1,
        "rpm": 1550.0,
        "torque": 34.1,
        "tool_wear": 12.0,
        "shap_values": {"air_temperature": -0.01, "process_temperature": 0.01, "rpm": 0.0, "torque": 0.01, "tool_wear": 0.0},
        "is_anomaly": False,
        "anomaly_score": -0.25,
        "timestamp": now_iso,
    }
}

# Seed seed records into buffer & incident log
for mid, mdata in fleet_status.items():
    historical_buffer[mid].append(mdata)
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

    # Classify multi-tier health
    if predicted_class == 1 or failure_probability >= 0.70:
        health_tier = "Critical"
    elif failure_probability >= 0.35 or is_anomaly or data.torque > 50 or data.process_temperature > 312:
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
        "air_temperature": round(data.air_temperature, 2),
        "process_temperature": round(data.process_temperature, 2),
        "rpm": round(data.rpm, 2),
        "torque": round(data.torque, 2),
        "tool_wear": round(data.tool_wear, 2),
        "shap_values": shap_values,
        "is_anomaly": is_anomaly,
        "anomaly_score": anomaly_score,
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

    return {
        "total": len(machines),
        "healthy": healthy_count,
        "warning": warning_count,
        "critical": critical_count,
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

    return {"status": "ingested", "machine_id": data.machine_id, "health_tier": result["health_tier"]}


@app.get("/latest")
def get_latest(machine_id: Optional[str] = Query(None)):
    if machine_id and machine_id in fleet_status:
        return fleet_status[machine_id]
    if fleet_status:
        return list(fleet_status.values())[0]
    return {"status": "WAITING"}


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