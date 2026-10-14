import json
import random
import time
from datetime import datetime
from kafka import KafkaProducer

KAFKA_SERVER = "localhost:9092"
KAFKA_TOPIC = "sensor-data"

producer = KafkaProducer(
    bootstrap_servers=KAFKA_SERVER,
    value_serializer=lambda value: json.dumps(value).encode("utf-8")
)

# Multi-machine fleet profiles
MACHINES = [
    {
        "id": "Machine-01",
        "name": "CNC Milling Alpha",
        "temp_base": 308.0,
        "torque_base": 38.0,
        "wear_rate": 0.5,
        "anomaly_chance": 0.05,
    },
    {
        "id": "Machine-02",
        "name": "Lathe Pro-X",
        "temp_base": 312.0,
        "torque_base": 50.0,
        "wear_rate": 1.2,
        "anomaly_chance": 0.20,
    },
    {
        "id": "Machine-03",
        "name": "Heavy Stamping Unit",
        "temp_base": 317.0,
        "torque_base": 65.0,
        "wear_rate": 2.5,
        "anomaly_chance": 0.45,
    },
    {
        "id": "Machine-04",
        "name": "Robotic Drill Rig",
        "temp_base": 306.0,
        "torque_base": 32.0,
        "wear_rate": 0.2,
        "anomaly_chance": 0.02,
    },
]

# Track accumulated tool wear per machine
machine_wear = {m["id"]: random.uniform(10, 50) for m in MACHINES}
# Pre-set high tool wear for Machine-03 to demonstrate realistic critical wear
machine_wear["Machine-03"] = 190.0
machine_wear["Machine-02"] = 145.0


def generate_sensor_data(machine):
    """
    Simulate sensor readings for a specific machine profile.
    """
    mid = machine["id"]
    machine_wear[mid] += machine["wear_rate"]
    if machine_wear[mid] > 240:
        machine_wear[mid] = random.uniform(10, 40)  # Reset after maintenance

    air_temperature = random.uniform(297, 301)
    process_temperature = machine["temp_base"] + random.uniform(-1.5, 2.5)
    rpm = random.uniform(1350, 1650)
    torque = machine["torque_base"] + random.uniform(-3.0, 4.0)
    tool_wear = machine_wear[mid]

    # Check for anomaly injection based on machine failure profile
    is_stress = random.random() < machine["anomaly_chance"]
    if is_stress:
        process_temperature += random.uniform(4.0, 9.0)
        torque += random.uniform(10.0, 22.0)
        rpm += random.uniform(-250, 200)

    return {
        "timestamp": datetime.now().isoformat(),
        "machine_id": mid,
        "machine_name": machine["name"],
        "air_temperature": round(air_temperature, 2),
        "process_temperature": round(process_temperature, 2),
        "rpm": round(rpm, 1),
        "torque": round(torque, 2),
        "tool_wear": round(tool_wear, 1),
    }


def main():
    print("=" * 60)
    print("🏭 Starting Multi-Machine IoT Fleet Simulator (4 Machines)")
    print(f"📡 Publishing to Kafka: {KAFKA_SERVER} | Topic: {KAFKA_TOPIC}")
    print("=" * 60)

    try:
        while True:
            for machine in MACHINES:
                sensor_data = generate_sensor_data(machine)
                producer.send(KAFKA_TOPIC, value=sensor_data)

                print(
                    f"[{sensor_data['machine_id']}] "
                    f"Temp: {sensor_data['process_temperature']}K | "
                    f"Torque: {sensor_data['torque']}Nm | "
                    f"Wear: {sensor_data['tool_wear']}min | "
                    f"RPM: {sensor_data['rpm']}"
                )

            producer.flush()
            print("-" * 60)
            time.sleep(2)

    except KeyboardInterrupt:
        print("\nMulti-machine simulator stopped.")
    finally:
        producer.close()


if __name__ == "__main__":
    main()