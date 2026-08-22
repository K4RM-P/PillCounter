"""Shared single-login auth (PRD §7.5/§12: one business-account login,
config-driven credential — not multi-user accounts).

Session tokens are HMAC-signed and carry an expiry, so no server-side
session store is needed. This is a v1-appropriate gate, not a general
auth system — revisit if/when the license/auth model changes (§12).
"""

import base64
import hashlib
import hmac
import json
import time

from fastapi import Header, HTTPException

from app.config import settings

TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 1 week


def _sign(payload: bytes) -> str:
    signature = hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(signature).decode()


def create_token() -> str:
    payload = json.dumps({"exp": time.time() + TOKEN_TTL_SECONDS}).encode()
    body = base64.urlsafe_b64encode(payload).decode()
    signature = _sign(payload)
    return f"{body}.{signature}"


def verify_token(token: str) -> bool:
    try:
        body, signature = token.split(".", 1)
        payload = base64.urlsafe_b64decode(body.encode())
        if not hmac.compare_digest(signature, _sign(payload)):
            return False
        data = json.loads(payload)
        return data["exp"] > time.time()
    except Exception:
        return False


def check_credentials(username: str, password: str) -> bool:
    return hmac.compare_digest(username, settings.AUTH_USERNAME) and hmac.compare_digest(
        password, settings.AUTH_PASSWORD
    )


def require_auth(authorization: str = Header(default="")) -> None:
    token = authorization.removeprefix("Bearer ").strip()
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
