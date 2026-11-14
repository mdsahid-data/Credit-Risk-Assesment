from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
import joblib
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

ml_model = {} 


@asynccontextmanager
async def lifespan(app: FastAPI):

    # Load the saved dictionary
    artifact = joblib.load(
        "credit_risk_Assesment_model.pkl"
    )

    # Extract actual model and threshold
    ml_model["model"] = artifact["model"]
    ml_model["threshold"] = float(artifact["threshold"])

    print("Model loaded successfully!")
    print("Threshold:", ml_model["threshold"])
    print("Model type:", type(ml_model["model"]))

    yield

    ml_model.clear()



app = FastAPI(lifespan=lifespan)


#The only columns that user will see and provide inputs.
class LoanApplication(BaseModel): #Pydantic Model (Validation)
    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


@app.post("/predict")
def predict(data: LoanApplication):

    if "model" not in ml_model:
        return {"error": "Model is not loaded"}

    input_df = pd.DataFrame([data.model_dump()])

    probability = float(
        ml_model["model"].predict_proba(input_df)[0, 1]
    )

    threshold = ml_model["threshold"]

    prediction = int(probability >= threshold)

    return {
        "default_probability": probability,
        "default_prediction": prediction,
        "threshold": threshold,
        "Result": "High Risk" if prediction == 1 else "Low Risk"
    }
app.mount("/", StaticFiles(directory="static", html=True), name="static")
