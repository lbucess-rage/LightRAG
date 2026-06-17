from __future__ import annotations

import hashlib
import secrets
import base64
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status

from .config import settings


def _with_pepper(secret: str, pepper: str) -> bytes:
    return f"{pepper}{secret}".encode("utf-8")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        _with_pepper(password, settings.password_pepper),
        bcrypt.gensalt(rounds=12),
    ).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    return bcrypt.checkpw(_with_pepper(password, settings.password_pepper), password_hash.encode())


def create_access_token(subject: str, role: str, metadata: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "metadata": metadata or {},
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def generate_api_key() -> str:
    return f"kmsadm_{secrets.token_urlsafe(32)}"


def hash_api_key(api_key: str) -> str:
    material = f"{settings.api_key_pepper}{api_key}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _api_key_cipher() -> Fernet:
    secret = settings.api_key_encryption_secret or settings.api_key_pepper
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_api_key(api_key: str) -> str:
    return _api_key_cipher().encrypt(api_key.encode("utf-8")).decode("utf-8")


def decrypt_api_key(api_key_encrypted: str) -> str:
    try:
        return _api_key_cipher().decrypt(api_key_encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("API key cannot be decrypted with the configured server secret") from exc


def mask_api_key_hash(api_key_hash: str) -> str:
    if not api_key_hash:
        return ""
    return f"{api_key_hash[:8]}...{api_key_hash[-6:]}"
