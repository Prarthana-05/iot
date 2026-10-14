from pyspark.sql import SparkSession
from pyspark.sql.functions import from_json, col
from pyspark.sql.types import StructType, StructField, StringType, DoubleType

spark = (
    SparkSession.builder
    .appName("IoT-Predictive-Maintenance-Fleet")
    .master("local[*]")
    .getOrCreate()
)

spark.sparkContext.setLogLevel("WARN")

# Sensor data schema — matches multi-machine telemetry
schema = StructType([
    StructField("timestamp", StringType(), True),
    StructField("machine_id", StringType(), True),
    StructField("machine_name", StringType(), True),
    StructField("air_temperature", DoubleType(), True),
    StructField("process_temperature", DoubleType(), True),
    StructField("rpm", DoubleType(), True),
    StructField("torque", DoubleType(), True),
    StructField("tool_wear", DoubleType(), True),
])

raw_stream = (
    spark.readStream
    .format("kafka")
    .option("kafka.bootstrap.servers", "kafka:29092")
    .option("subscribe", "sensor-data")
    .option("startingOffsets", "latest")
    .load()
)

json_stream = raw_stream.select(col("value").cast("string").alias("json_data"))

sensor_stream = json_stream.select(
    from_json(col("json_data"), schema).alias("data")
).select("data.*")

clean_stream = sensor_stream.filter(
    col("air_temperature").isNotNull() &
    col("process_temperature").isNotNull() &
    col("rpm").isNotNull() &
    col("torque").isNotNull() &
    col("tool_wear").isNotNull()
)

query = (
    clean_stream.writeStream
    .format("console")
    .outputMode("append")
    .option("truncate", False)
    .start()
)

query.awaitTermination()