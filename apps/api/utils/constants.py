"""
Cosmo AI - Application Constants
Centralized storage for magic strings, UI paths, and system labels.
"""

from pathlib import Path

# UI Pages
UI_PAGE_CHAT = "index.html"
UI_PAGE_ADMIN = "index.html"
UI_PAGE_FAVICON = "favicon.ico"

# System Labels
SYSTEM_NAME = "Cosmo AI"
SYSTEM_VERSION = "1.4.1"
SYSTEM_DESCRIPTION = "Production-grade AI environment with native BitNet JSI, autonomous research, and privacy-shielded multi-agent governance."

# Runtime Profiles
PROFILE_LOW_POWER = "low-power"
PROFILE_CUSTOM = "custom"

# Feature Flags
ENV_POWER_PROFILE = "COSMO_POWER_PROFILE"
ENV_TEST_MODE = "COSMO_TEST_MODE"

# Health Check
HEALTH_OK = "ok"
HEALTH_SERVICE_NAME = "cosmo-ai"
