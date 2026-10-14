# PredictAI — Real-Time IoT Fleet Predictive Maintenance Platform

An enterprise-grade, distributed IoT predictive maintenance and anomaly detection system. It ingests simulated high-frequency industrial sensor telemetry through **Apache Kafka**, evaluates failure probabilities in real time using **Apache Spark ML (Random Forest)**, calculates feature attributions via **Explainable AI (SHAP)**, persists telemetry into **InfluxDB**, and visualizes factory fleet operations on a live **React 19** dashboard.

---

## 🏛️ System Architecture & Data Flow

```text
 ┌──────────────────────────────────────────────────────────────────┐
 │                  Industrial IoT Factory Fleet                    │
 │  (Machine-01: CNC  |  Machine-02: Lathe  |  Machine-03: Stamping)│
 └─────────────────────────────────┬────────────────────────────────┘
                                   │ (Simulated Sensor Telemetry)
                                   ▼
                   ┌───────────────────────────────┐
                   │    Apache Kafka Broker        │
                   │    Topic: 'sensor-data'       │
                   └───────┬───────────────┬───────┘
                           │               │
                           ▼               ▼
           ┌──────────────────────┐  ┌─────────────────────────┐
           │ PySpark Streaming    │  │ Kafka Consumer Bridge   │
           │ (Batch Validation)   │  │ (kafka/consumer.py)     │
           └──────────────────────┘  └─────────────┬───────────┘
                                                   │ HTTP POST /ingest
                                                   ▼
                   ┌───────────────────────────────────────────┐
                   │           FastAPI Backend Engine          │
                   │                                           │
                   │  1. Spark ML Pipeline (Failure Prediction)│
                   │  2. Isolation Forest (Anomaly Score)      │
                   │  3. SHAP TreeExplainer (Root Cause)       │
                   └───────┬───────────────────────────┬───────┘
                           │                           │
                           ▼                           ▼
        ┌────────────────────────────┐    ┌───────────────────────────┐
        │ InfluxDB Time-Series DB    │    │ React 19 + Vite Dashboard │
        │ (Audit & Incident History) │    │ (Live Real-Time Polling)  │
        └────────────────────────────┘    └───────────────────────────┘
```

---

## 🚀 Key Features

* **Multi-Machine Fleet Monitoring:** Concurrently streams and classifies telemetry across multiple machines into three health tiers: `Healthy`, `Warning`, and `Critical`.
* **High-Throughput Streaming:** Uses **Apache Kafka** to handle live telemetry packets for Air Temp, Process Temp, RPM, Torque, and Tool Wear.
* **Dual Machine Learning Architecture:**
  * **PySpark ML (Random Forest):** Predicts machine failure probability (0–100%).
  * **Isolation Forest:** Identifies multivariate sensor deviations and flags anomalies.
* **Explainable AI (SHAP):** Real-time feature attribution bar charts pinpointing *why* a machine is failing (e.g., thermal dissipation vs. mechanical strain).
* **Time-Series Persistence (InfluxDB):** Automatically archives sensor readings, anomaly scores, and incident logs with root-cause tags.
* **What-If Simulation Sandbox:** Interactive parameter sliders to stress-test the ML models with hypothetical operating conditions.

---

## 📋 Prerequisites

Before running the project, ensure you have the following installed on your machine:

1. **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (Must be open and running)
2. **[Python 3.10 or 3.11](https://www.python.org/downloads/)**
3. **[Node.js (v18+) & npm](https://nodejs.org/)**
4. **Java JRE/JDK 8, 11, or 17** (Required on Windows for PySpark)

---

## 🖥️ Terminal Execution Guide (Step-by-Step)

To run the entire platform, open **5 separate terminal windows** and execute the commands below in order:

---

### Terminal 1: Infrastructure (Docker)
Start the Kafka broker, Zookeeper, and InfluxDB time-series database in the background:

```powershell
cd D:\iot
docker compose -f docker/docker-compose.yml up -d zookeeper kafka influxdb
```
> *Wait ~15–20 seconds for the containers to fully initialize before starting the backend.*

---

### Terminal 2: Backend API (FastAPI + PySpark)
Activate your Python virtual environment and run the backend server:

```powershell
cd D:\iot\backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
> *Backend will load the Spark ML model, SHAP explainer, and InfluxDB connector. Ready when `Uvicorn running on http://0.0.0.0:8000` appears.*

---

### Terminal 3: Frontend Dashboard (React + Vite)
Start the user interface development server:

```powershell
cd D:\iot\frontend
npm install
npm run dev
```
> *Open your browser at: **`http://localhost:5173`***

---

### Terminal 4: Kafka Producer (Fleet Sensor Simulator)
Start generating live multi-machine telemetry data and publishing to Kafka:

```powershell
cd D:\iot
.\backend\.venv\Scripts\Activate.ps1
python kafka/producer.py
```
> *Simulates 4 industrial machines with distinct operational health and wear profiles every 2 seconds.*

---

### Terminal 5: Kafka Consumer (Ingestion Bridge)
Consume live messages from Kafka and forward them to the backend for real-time ML inference:

```powershell
cd D:\iot
.\backend\.venv\Scripts\Activate.ps1
python kafka/consumer.py
```
> *You will see continuous live statuses outputting: `[Machine-01] -> Status: Healthy`, `[Machine-03] -> Status: Critical`.*

---

## 🏭 Multi-Machine Fleet Profiles

| Machine ID | Machine Name | Operational Profile | Typical Status |
| :--- | :--- | :--- | :--- |
| **Machine-01** | CNC Milling Alpha | Nominal operating envelope, baseline wear | 🟢 **Healthy** |
| **Machine-02** | Lathe Pro-X | Elevated torque & moderate tool wear | 🟡 **Warning** |
| **Machine-03** | Heavy Stamping Unit | High process temperature & critical wear | 🔴 **Critical** |
| **Machine-04** | Robotic Drill Rig | Newly calibrated unit, low mechanical strain | 🟢 **Healthy** |

---

## 📂 Project Directory Structure

```text
d:\iot\
│
├── backend\                    # FastAPI Server & Machine Learning Models
│   ├── app\
│   │   ├── main.py             # FastAPI entrypoint, PySpark inference & InfluxDB write
│   │   └── models\             # Serialized Spark ML, SHAP & Anomaly artifacts
│   ├── requirements.txt        # Python dependencies
│   └── Dockerfile              # Backend containerization spec
│
├── frontend\                   # React 19 + Vite Dashboard
│   ├── src\
│   │   ├── App.jsx             # Main dashboard UI (Fleet, Dashboard, History, What-If)
│   │   └── index.css           # Industrial dashboard styling
│   ├── package.json            # Node dependencies (Recharts, Lucide, Vite)
│   └── vite.config.js
│
├── kafka\                      # Streaming Pipeline
│   ├── producer.py             # Multi-machine Kafka sensor telemetry generator
│   └── consumer.py             # Kafka consumer forwarding packets to /ingest
│
├── spark\                      # Spark Processing
│   └── streaming.py            # PySpark structured streaming validation script
│
├── docker\                     # Infrastructure Orchestration
│   └── docker-compose.yml      # Zookeeper, Kafka broker & InfluxDB services
│
├── .gitignore                  # Git exclusions (.venv, node_modules, caches)
└── README.md                   # Project documentation
```

---

## 🛠️ API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | API status and loaded model metadata |
| `GET` | `/fleet` | Returns overall fleet health counts and summary for all machines |
| `GET` | `/latest?machine_id=...` | Returns the latest sensor readings, SHAP values, and risk scores for a machine |
| `GET` | `/history?machine_id=...` | Queries InfluxDB for historical audit logs and incident records |
| `POST` | `/ingest` | Ingestion endpoint called by the Kafka consumer to run inference and persist data |
| `POST` | `/predict` | Ad-hoc prediction endpoint used by the What-If Simulator |

---

## 🔒 License
This project is developed for educational, industrial IoT demonstration, and research purposes.

