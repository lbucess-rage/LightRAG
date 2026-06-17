from kms_admin.security import (
    create_access_token,
    decode_access_token,
    decrypt_api_key,
    encrypt_api_key,
    generate_api_key,
    hash_api_key,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip():
    password_hash = hash_password("strong-password")

    assert password_hash != "strong-password"
    assert verify_password("strong-password", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_api_key_hash_is_stable_without_storing_plaintext():
    api_key = generate_api_key()
    first_hash = hash_api_key(api_key)
    second_hash = hash_api_key(api_key)

    assert api_key.startswith("kmsadm_")
    assert first_hash == second_hash
    assert api_key not in first_hash


def test_api_key_encryption_roundtrip():
    api_key = generate_api_key()
    encrypted = encrypt_api_key(api_key)

    assert encrypted != api_key
    assert api_key not in encrypted
    assert decrypt_api_key(encrypted) == api_key


def test_access_token_contains_role_and_subject():
    token = create_access_token("admin", "admin", {"kms_workspace": "base"})
    payload = decode_access_token(token)

    assert payload["sub"] == "admin"
    assert payload["role"] == "admin"
    assert payload["metadata"]["kms_workspace"] == "base"
