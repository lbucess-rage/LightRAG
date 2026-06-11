import pytest

from kms_admin.roles import normalize_role, validate_role


def test_viewer_role_is_legacy_alias_for_user():
    assert normalize_role("viewer") == "user"
    assert validate_role("viewer") == "user"


def test_validate_role_rejects_unknown_role():
    with pytest.raises(ValueError):
        validate_role("operator")
