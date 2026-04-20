"""Unit tests for envelope encryption (llm_wiki_core.crypto)."""

from __future__ import annotations

import pytest

from llm_wiki_core.crypto import decrypt_value, encrypt_value


def test_roundtrip():
    plaintext = "sk-abc123XYZ-secretkey"
    encrypted = encrypt_value(plaintext)
    assert encrypted.ciphertext != plaintext.encode("utf-8")
    assert decrypt_value(encrypted.ciphertext, encrypted.key_version) == plaintext


def test_empty_string_rejected():
    with pytest.raises(ValueError):
        encrypt_value("")


def test_missing_key_version_rejected():
    encrypted = encrypt_value("sk-secret")
    with pytest.raises(RuntimeError):
        decrypt_value(encrypted.ciphertext, None)


def test_different_inputs_produce_different_ciphertexts():
    c1 = encrypt_value("key-one")
    c2 = encrypt_value("key-two")
    assert c1.ciphertext != c2.ciphertext


def test_same_input_produces_different_ciphertexts():
    c1 = encrypt_value("same-key")
    c2 = encrypt_value("same-key")
    assert c1.ciphertext != c2.ciphertext
    assert decrypt_value(c1.ciphertext, c1.key_version) == decrypt_value(c2.ciphertext, c2.key_version) == "same-key"


def test_unicode_roundtrip():
    plaintext = "密钥-тест-🔑"
    encrypted = encrypt_value(plaintext)
    assert decrypt_value(encrypted.ciphertext, encrypted.key_version) == plaintext
