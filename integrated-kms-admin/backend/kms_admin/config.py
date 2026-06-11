from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _default_admin_port(lightrag_base_url: str) -> int:
    parsed = urlparse(lightrag_base_url)
    if parsed.port:
        return parsed.port + 100
    return 9522


DEV_JWT_SECRET = "dev-only-change-me-secret-with-32-bytes"
DEV_BOOTSTRAP_PASSWORD = "admin123"


def _postgres_dsn_from_env() -> str:
    explicit = os.getenv("KMS_ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL")
    if explicit:
        return explicit

    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "postgres")
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = os.getenv("POSTGRES_DATABASE", os.getenv("POSTGRES_DB", "lightrag"))
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


@dataclass(frozen=True)
class Settings:
    environment: str = os.getenv("KMS_ADMIN_ENV", os.getenv("ENV", "development")).lower()
    require_production_secrets: bool = _env_bool("KMS_ADMIN_REQUIRE_SECRETS", False)
    lightrag_base_url: str = os.getenv("LIGHTRAG_BASE_URL", "http://127.0.0.1:9422")
    lightrag_api_key: str | None = os.getenv("LIGHTRAG_API_KEY")
    lightrag_bearer_token: str | None = os.getenv("LIGHTRAG_BEARER_TOKEN")
    database_url: str = _postgres_dsn_from_env()
    jwt_secret: str = os.getenv(
        "KMS_ADMIN_JWT_SECRET",
        os.getenv("TOKEN_SECRET", DEV_JWT_SECRET),
    )
    jwt_algorithm: str = os.getenv("KMS_ADMIN_JWT_ALGORITHM", "HS256")
    jwt_expire_minutes: int = _env_int("KMS_ADMIN_JWT_EXPIRE_MINUTES", 480)
    password_pepper: str = os.getenv("ADMIN_PASSWORD_PEPPER", "")
    api_key_pepper: str = os.getenv("KMS_ADMIN_API_KEY_PEPPER", "")
    bootstrap_admin_id: str = os.getenv("ADMIN_BOOTSTRAP_ID", "admin")
    bootstrap_admin_password: str = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", DEV_BOOTSTRAP_PASSWORD)
    default_tenant_id: str = os.getenv("KMS_ADMIN_DEFAULT_TENANT_ID", "default")
    default_tenant_name: str = os.getenv("KMS_ADMIN_DEFAULT_TENANT_NAME", "전기차충전 고객센터")
    default_kms_workspace: str = os.getenv("KMS_ADMIN_DEFAULT_KMS_WORKSPACE", "kevcs")
    default_faq_workspace: str = os.getenv(
        "KMS_ADMIN_DEFAULT_FAQ_WORKSPACE",
        "kevcs_faq_pair_20260609_145749",
    )
    host: str = os.getenv("KMS_ADMIN_HOST", "0.0.0.0")
    port: int = _env_int(
        "KMS_ADMIN_PORT",
        _default_admin_port(os.getenv("LIGHTRAG_BASE_URL", "http://127.0.0.1:9422")),
    )
    log_dir: str = os.getenv("KMS_ADMIN_LOG_DIR", os.getenv("LOG_DIR", "logs"))
    log_backup_days: int = _env_int("KMS_ADMIN_LOG_BACKUP_DAYS", 30)
    cors_origins: tuple[str, ...] = tuple(
        item.strip()
        for item in os.getenv("KMS_ADMIN_CORS_ORIGINS", "*").split(",")
        if item.strip()
    )
    auto_migrate: bool = _env_bool("KMS_ADMIN_AUTO_MIGRATE", True)

    @property
    def safe_database_url(self) -> str:
        parsed = urlparse(self.database_url)
        if not parsed.password:
            return self.database_url
        netloc = parsed.netloc.replace(f":{parsed.password}@", ":***@")
        return urlunparse(parsed._replace(netloc=netloc))

    @property
    def production_like(self) -> bool:
        return self.require_production_secrets or self.environment in {"prod", "production"}

    def validate_for_startup(self) -> None:
        if not self.production_like:
            return
        errors: list[str] = []
        if self.jwt_secret == DEV_JWT_SECRET or len(self.jwt_secret) < 32:
            errors.append("KMS_ADMIN_JWT_SECRET must be set to a non-default value with at least 32 characters")
        if len(self.password_pepper) < 16:
            errors.append("ADMIN_PASSWORD_PEPPER must be set with at least 16 characters")
        if len(self.api_key_pepper) < 16:
            errors.append("KMS_ADMIN_API_KEY_PEPPER must be set with at least 16 characters")
        if self.bootstrap_admin_password == DEV_BOOTSTRAP_PASSWORD or len(self.bootstrap_admin_password) < 12:
            errors.append("ADMIN_BOOTSTRAP_PASSWORD must be changed from the development default and be at least 12 characters")
        if errors:
            raise RuntimeError("Invalid KMS admin production configuration: " + "; ".join(errors))


settings = Settings()
