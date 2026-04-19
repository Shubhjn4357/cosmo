"""
Cosmo AI - Encryption Utilities
Encrypt/decrypt sensitive data like API keys
"""

import os
import base64
from cryptography.fernet import Fernet  # type: ignore
from cryptography.hazmat.primitives import hashes  # type: ignore
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC  # type: ignore
from loguru import logger


# Get encryption key from environment or generate one
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
ENCRYPTION_SALT = os.getenv("ENCRYPTION_SALT", "cosmo-ai-salt-2024")


def get_fernet_key() -> bytes:
    """
    Get or generate Fernet encryption key
   
    Returns:
        Encryption key bytes
    """
    if ENCRYPTION_KEY:
        try:
            # Check if it's already a valid Fernet key
            Fernet(ENCRYPTION_KEY.encode())
            return ENCRYPTION_KEY.encode()
        except:
            pass
            
    # Generate key from salt (deterministic for same salt)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=ENCRYPTION_SALT.encode(),
        iterations=100000,
    )
    # Derive a key from the encryption key (or a default)
    derived = kdf.derive(ENCRYPTION_KEY.encode() if ENCRYPTION_KEY else b"cosmo-default-internal-key")
    return base64.urlsafe_b64encode(derived)


def encrypt_string(plaintext: str) -> str:
    """
    Encrypt a string using Fernet
   
    Args:
        plaintext: String to encrypt
       
    Returns:
        Encrypted string (base64 encoded)
    """
    if not plaintext:
        return ""
    try:
        fernet = Fernet(get_fernet_key())
        return fernet.encrypt(plaintext.encode()).decode()
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        return plaintext


def decrypt_string(encrypted: str) -> str:
    """
    Decrypt an encrypted string
   
    Args:
        encrypted: Encrypted string (base64 encoded)
       
    Returns:
        Decrypted plaintext string
    """
    if not encrypted:
        return ""
    try:
        fernet = Fernet(get_fernet_key())
        return fernet.decrypt(encrypted.encode()).decode()
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        # Return as-is if decryption fails (might be unencrypted legacy data)
        return encrypted


def encrypt_api_key(api_key: str) -> str:
    """
    Encrypt an API key for storage
   
    Args:
        api_key: API key to encrypt
       
    Returns:
        Encrypted API key
    """
    if not api_key:
        return ""
    return f"enc:{encrypt_string(api_key)}"


def decrypt_api_key(encrypted_key: str) -> str:
    """
    Decrypt an API key
   
    Args:
        encrypted_key: Encrypted API key
       
    Returns:
        Decrypted API key
    """
    if not encrypted_key:
        return ""
   
    # Check if it's encrypted (starts with "enc:")
    if encrypted_key.startswith("enc:"):
        return decrypt_string(encrypted_key[4:])
   
    # Return as-is if not encrypted (legacy data)
    return encrypted_key


# ─── JSONL Encryption Helpers ────────────────────────────────────────────────

class EncryptedJSONLWriter:
    """Stream-friendly encrypted JSONL writer for memory graphs."""
    def __init__(self, file_path: Path):  # type: ignore
        self.file_path = file_path

    def append(self, record: dict):
        """Encrypts and appends a dictionary as a single line."""
        import json
        json_str = json.dumps(record, ensure_ascii=False)
        encrypted = encrypt_string(json_str)
        with self.file_path.open("a", encoding="utf-8") as f:
            f.write(encrypted + "\n")

class EncryptedJSONLReader:
    """Stream-friendly encrypted JSONL reader with legacy fallback."""
    def __init__(self, file_path: Path):  # type: ignore
        self.file_path = file_path

    def __iter__(self):
        import json
        if not self.file_path.exists():
            return
        with self.file_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line: continue
                # Decrypt
                decrypted = decrypt_string(line)
                try:
                    yield json.loads(decrypted)
                except Exception:
                    # Fallback for unencrypted legacy data
                    try:
                        yield json.loads(line)
                    except:
                        logger.warning(f"Skipping corrupted line in {self.file_path.name}")
                        continue
