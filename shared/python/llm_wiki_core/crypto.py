from __future__ import annotations

import base64
import secrets
from dataclasses import dataclass
from functools import lru_cache

import orjson
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_settings


@lru_cache(maxsize=1)
def _get_keyring() -> dict[str, bytes]:
    settings = get_settings()
    raw = orjson.loads(settings.keyring_json)
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("KEYRING_JSON must be a non-empty JSON object")

    keyring: dict[str, bytes] = {}
    for version, encoded_key in raw.items():
        if not isinstance(version, str) or not version:
            raise RuntimeError("KEYRING_JSON contains an invalid key version")
        if not isinstance(encoded_key, str):
            raise RuntimeError(f"KEYRING_JSON entry '{version}' must be a base64 string")
        padding = "=" * (-len(encoded_key) % 4)
        key = base64.urlsafe_b64decode((encoded_key + padding).encode("utf-8"))
        if len(key) != 32:
            raise RuntimeError(f"KEYRING_JSON entry '{version}' must decode to 32 bytes")
        keyring[version] = key

    if settings.active_key_version not in keyring:
        raise RuntimeError(f"ACTIVE_KEY_VERSION '{settings.active_key_version}' is missing from KEYRING_JSON")
    return keyring


@dataclass(slots=True)
class EncryptedValue:
    ciphertext: bytes
    key_version: str


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode("utf-8")


def _b64decode(value: str) -> bytes:
    return base64.b64decode(value.encode("utf-8"))


def _coerce_bytes(value: bytes | bytearray | memoryview | None) -> bytes:
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, memoryview):
        return value.tobytes()
    raise TypeError(f"Unsupported ciphertext type: {type(value)!r}")


def encrypt_value(plaintext: str) -> EncryptedValue:
    if not plaintext:
        raise ValueError("Secret plaintext must not be empty")

    settings = get_settings()
    keyring = _get_keyring()
    key_version = settings.active_key_version
    wrapping_key = keyring[key_version]

    data_key = secrets.token_bytes(32)
    wrapped_key_nonce = secrets.token_bytes(12)
    data_nonce = secrets.token_bytes(12)

    wrapped_key = AESGCM(wrapping_key).encrypt(wrapped_key_nonce, data_key, None)
    ciphertext = AESGCM(data_key).encrypt(data_nonce, plaintext.encode("utf-8"), None)

    payload = {
        "wrapped_key": _b64(wrapped_key),
        "wrapped_key_nonce": _b64(wrapped_key_nonce),
        "data_nonce": _b64(data_nonce),
        "ciphertext": _b64(ciphertext),
    }
    return EncryptedValue(ciphertext=orjson.dumps(payload), key_version=key_version)


def decrypt_value(ciphertext: bytes | bytearray | memoryview | None, key_version: str | None) -> str:
    raw_ciphertext = _coerce_bytes(ciphertext)
    if not raw_ciphertext:
        return ""
    if not key_version:
        raise RuntimeError("Encrypted secret is missing key_version")

    keyring = _get_keyring()
    if key_version not in keyring:
        raise RuntimeError(f"Unknown key version '{key_version}'")

    payload = orjson.loads(raw_ciphertext)
    if not isinstance(payload, dict):
        raise RuntimeError("Encrypted secret payload is invalid")

    wrapped_key = _b64decode(str(payload["wrapped_key"]))
    wrapped_key_nonce = _b64decode(str(payload["wrapped_key_nonce"]))
    data_nonce = _b64decode(str(payload["data_nonce"]))
    secret_ciphertext = _b64decode(str(payload["ciphertext"]))

    data_key = AESGCM(keyring[key_version]).decrypt(wrapped_key_nonce, wrapped_key, None)
    plaintext = AESGCM(data_key).decrypt(data_nonce, secret_ciphertext, None)
    return plaintext.decode("utf-8")


def masked_secret(ciphertext: bytes | bytearray | memoryview | None, key_version: str | None) -> str | None:
    if not _coerce_bytes(ciphertext) or not key_version:
        return None
    return "********"
