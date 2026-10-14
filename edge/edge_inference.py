import tensorflow as tf
import joblib
import numpy as np
import json
import time
from kafka import KafkaConsumer

interpreter = tf.lite.Interpreter(model_path="edge_model.tflite")
interpreter.allocate_tensors()
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

scaler = joblib.load("edge_scaler.pkl")

FEATURE_NAMES = ["air_temperature", "process_temperature", "rpm", "torque", "tool_wear"]


def edge_predict(sensor_reading):
    X = np.array([[sensor_reading[f] for f in FEATURE_NAMES]], dtype=np.float32)
    X_scaled = scaler.transform(X).astype(np.float32)

    interpreter.set_tensor(input_details[0]['index'], X_scaled)
    interpreter.invoke()
    prob = interpreter.get_tensor(output_details[0]['index'])[0][0]

    prediction = 1 if prob > 0.5 else 0
    return prediction, float(prob)


def main():
    consumer = KafkaConsumer(
        "sensor-data",
        bootstrap_servers="localhost:9092",
        auto_offset_reset="latest",
        group_id="edge-consumer-group",
        value_deserializer=lambda x: json.loads(x.decode("utf-8"))
    )

    print("🔌 Edge device simulator started (TFLite model)")
    print("Listening for sensor data...\n")

    for message in consumer:
        data = message.value

        start = time.time()
        prediction, probability = edge_predict(data)
        latency = (time.time() - start) * 1000

        status = "FAILURE RISK" if prediction == 1 else "NORMAL"

        print(
            f"[EDGE] {data['timestamp']} | "
            f"Status: {status} ({probability*100:.2f}%) | "
            f"Inference time: {latency:.3f}ms"
        )


if __name__ == "__main__":
    main()