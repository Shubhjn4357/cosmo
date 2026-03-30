"""
Whisper AI - Encryption Utilities
Encrypt/decrypt sensitive data like API keys
"""

import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from loguru import logger


# Get encryption key from environment or generate one
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
ENCRYPTION_SALT = os.getenv("ENCRYPTION_SALT", "whisper-ai-salt-2024")


def get_fernet_key() -> bytes:
    """
    Get or generate Fernet encryption key
   
    Returns:
        Encryption key bytes
    """
    if ENCRYPTION_KEY:
        # Use provided key
        return ENCRYPTION_KEY.encode()
   
    # Generate key from salt (deterministic for same salt)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=ENCRYPTION_SALT.encode(),
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(b"whisper-ai-master-key"))
    return key


def encrypt_string(plaintext: str) -> str:
    """
    Encrypt a string
   
    Args:
        plaintext: String to encrypt
       
    Returns:
        Encrypted string (base64 encoded)
    """
    try:
        fernet = Fernet(get_fernet_key())
        encrypted = fernet.encrypt(plaintext.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        # Return original if encryption fails (fallback)
        return plaintext


def decrypt_string(encrypted: str) -> str:
    """
    Decrypt an encrypted string
   
    Args:
        encrypted: Encrypted string (base64 encoded)
       
    Returns:
        Decrypted plaintext string
    """
    try:
        fernet = Fernet(get_fernet_key())
        decoded = base64.urlsafe_b64decode(encrypted.encode())
        decrypted = fernet.decrypt(decoded)
        return decrypted.decode()
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
