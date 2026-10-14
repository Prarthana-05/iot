from pyspark.sql.functions import col


def create_features(df):
    return df.select(
        col("temperature"),
        col("vibration"),
        col("pressure"),
        col("rpm"),
        col("status"),
        col("anomaly")
    )