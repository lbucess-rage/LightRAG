from dataclasses import replace

import pytest

from kms_admin.config import DEV_JWT_SECRET, Settings
from kms_admin.routers.lightrag import _filter_workspace_response
from kms_admin.routers.system import _period_days


def test_period_days_defaults_and_known_values():
    assert _period_days("24h") == 1
    assert _period_days("7d") == 7
    assert _period_days("30d") == 30
    assert _period_days("unknown") == 7


def test_production_settings_reject_development_secrets():
    settings = replace(
        Settings(),
        environment="production",
        jwt_secret=DEV_JWT_SECRET,
        password_pepper="",
        api_key_pepper="",
        bootstrap_admin_password="admin123",
    )

    with pytest.raises(RuntimeError) as exc:
        settings.validate_for_startup()

    message = str(exc.value)
    assert "KMS_ADMIN_JWT_SECRET" in message
    assert "ADMIN_PASSWORD_PEPPER" in message
    assert "KMS_ADMIN_API_KEY_PEPPER" in message
    assert "ADMIN_BOOTSTRAP_PASSWORD" in message


def test_production_settings_accept_required_secrets():
    settings = replace(
        Settings(),
        environment="production",
        jwt_secret="jwt-secret-for-production-1234567890",
        password_pepper="password-pepper-1234",
        api_key_pepper="api-key-pepper-1234",
        bootstrap_admin_password="bootstrap-password-1234",
    )

    settings.validate_for_startup()


def test_non_admin_workspace_list_is_limited_to_account_pair():
    response = {
        "workspaces": [
            {"workspace_id": "kms-a"},
            {"workspace_id": "faq-a"},
            {"workspace_id": "kms-b"},
        ],
        "total": 3,
    }

    filtered = _filter_workspace_response(
        response,
        {
            "role": "manager",
            "kms_workspace": "kms-a",
            "faq_workspace": "faq-a",
        },
    )

    assert [item["workspace_id"] for item in filtered["workspaces"]] == ["kms-a", "faq-a"]
    assert filtered["total"] == 2


def test_admin_workspace_list_is_not_filtered():
    response = {"workspaces": [{"workspace_id": "kms-a"}, {"workspace_id": "kms-b"}], "total": 2}

    assert _filter_workspace_response(response, {"role": "admin"}) is response
