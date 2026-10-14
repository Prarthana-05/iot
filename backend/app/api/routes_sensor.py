from fastapi import APIRouter

router = APIRouter(prefix="/sensor", tags=["Sensor"])


@router.get("/latest")
def latest_sensor():
    return {
        "temperature": 65.5,
        "vibration": 2.4,
        "pressure": 31.2,
        "rpm": 1502,
        "status": "NORMAL"
    }