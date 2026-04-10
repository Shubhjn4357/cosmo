import os
import sys
from huggingface_hub import HfApi
from dotenv import dotenv_values

print("Parsing .env file...")
secrets = dotenv_values(".env")

HF_TOKEN = secrets.get("HF_TOKEN")
REPO_ID = "shubhjn/whisper-ai"

if not HF_TOKEN:
    print("❌ Error: HF_TOKEN not found in .env file.")
    sys.exit(1)

print(f"Connecting to Space: {REPO_ID}...")
api = HfApi(token=HF_TOKEN)

print("Fetching currently deployed settings from Hugging Face...")
try:
    existing_vars = api.get_space_variables(REPO_ID)
except Exception as e:
    print(f"⚠️ Warning: Could not fetch existing variables. Assuming none. ({e})")
    existing_vars = {}

def is_secret(key: str) -> bool:
    """Determine if a key should be a hidden Secret or a visible Variable."""
    secret_keywords = ["KEY", "TOKEN", "SECRET", "PASS", "SALT", "HASH", "AUTH"]
    key_upper = key.upper()
    return any(kw in key_upper for kw in secret_keywords)

changes_made = False

for key, value in secrets.items():
    if not key or not value or key.startswith("#") or key == "HF_TOKEN":
        continue

    val_str = str(value).strip()
    
    try:
        if is_secret(key):
            # We cannot read secret values back from HF for security reasons, so we push them.
            print(f"🔒 Pushing SECRET: {key}")
            api.add_space_secret(repo_id=REPO_ID, key=key, value=val_str)
            changes_made = True
        else:
            if key in existing_vars and existing_vars[key].value == val_str:
                print(f"⏩ Skipping VARIABLE: {key} (Already identical)")
            else:
                action = "Updating" if key in existing_vars else "Creating"
                print(f"📄 {action} VARIABLE: {key}")
                api.add_space_variable(repo_id=REPO_ID, key=key, value=val_str)
                changes_made = True
    except Exception as e:
        print(f"❌ Failed to push {key}: {e}")

if changes_made:
    print("\n✅ Configuration successfully synced! Your HF Space will restart to apply the updates.")
else:
    print("\n✅ Configuration identical! No changes needed, skipping restart.")
