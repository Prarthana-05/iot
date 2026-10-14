import json
import requests
from kafka import KafkaConsumer

INGEST_URL = "http://localhost:8000/ingest"

consumer = KafkaConsumer(
    "sensor-data",
    bootstrap_servers="localhost:9092",
    auto_offset_reset="latest",
    enable_auto_commit=True,
    group_id="iot-consumer-group",
    value_deserializer=lambda x: json.loads(x.decode("utf-8"))
)

print("🚀 Kafka Multi-Machine Consumer started, streaming telemetry to backend...\n")

for message in consumer:
    data = message.value

    payload = {
        "machine_id": data.get("machine_id", "Machine-01"),
        "machine_name": data.get("machine_name", "Machine 01"),
        "air_temperature": data["air_temperature"],
        "process_temperature": data["process_temperature"],
        "rpm": data["rpm"],
        "torque": data["torque"],
        "tool_wear": data["tool_wear"],
    }

    try:
        response = requests.post(INGEST_URL, json=payload, timeout=20)
        res_data = response.json()
        print(f"[{data.get('timestamp', 'NOW')}] [{payload['machine_id']}] -> Status: {res_data.get('health_tier', 'OK')}")
    except Exception as e:
        print(f"Error forwarding {payload['machine_id']} to backend: {e}")