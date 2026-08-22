from fastapi import APIRouter, HTTPException

from app.auth import check_credentials, create_token
from app.schemas import LoginRequest, LoginResponse

router = APIRouter(prefix="/api")


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    if not check_credentials(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return LoginResponse(token=create_token())
