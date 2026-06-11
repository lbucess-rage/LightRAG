from __future__ import annotations

CANONICAL_ROLES = {"user", "manager", "admin"}
LEGACY_ROLE_ALIASES = {
    "viewer": "user",
}


def normalize_role(role: str | None) -> str:
    normalized = str(role or "user").strip().lower()
    return LEGACY_ROLE_ALIASES.get(normalized, normalized)


def validate_role(role: str | None) -> str:
    normalized = normalize_role(role)
    if normalized not in CANONICAL_ROLES:
        raise ValueError(f"Unsupported role: {role}")
    return normalized
