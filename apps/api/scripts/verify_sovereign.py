import sys
import os
from pathlib import Path
import json

# Add root to sys.path
sys.path.append(str(Path(__file__).resolve().parents[1]))

def check_server():
    print("--- SERVER VERIFICATION ---")
    
    # 1. Imports
    try:
        from services.wallet_service import wallet_service
        print("[OK] WalletService imported")
        print(f"     Address: {wallet_service.address}")
    except Exception as e:
        print(f"[FAIL] WalletService import failed: {e}")

    try:
        from services.skills_service import skills_service
        print("[OK] SkillsService imported")
        print(f"     Loaded skills: {skills_service.list_skills()}")
    except Exception as e:
        print(f"[FAIL] SkillsService import failed: {e}")

    try:
        from services.automation_service import automation_service
        print("[OK] AutomationService imported")
    except Exception as e:
        print(f"[FAIL] AutomationService import failed: {e}")

    # 2. API Routes (Check by scanning file content to avoid heavy dependency errors)
    try:
        admin_path = Path(__file__).resolve().parents[1] / "api" / "routes" / "admin.py"
        content = admin_path.read_text(encoding="utf-8")
        target_routes = ["/agent-status", "/agent-skills", "/agent-automation/toggle"]
        for tr in target_routes:
            if tr in content:
                print(f"[OK] Route {tr} implementation found in admin.py")
            else:
                print(f"[FAIL] Route {tr} NOT found in admin.py")
    except Exception as e:
        print(f"[FAIL] Admin Route verification failed: {e}")

def check_app():
    print("\n--- APP VERIFICATION ---")
    app_root = Path(__file__).resolve().parents[2] / "cosmo"
    package_json = app_root / "package.json"
    
    if package_json.exists():
        try:
            data = json.loads(package_json.read_text(encoding="utf-8"))
            deps = data.get("dependencies", {})
            if "viem" in deps:
                print("[OK] viem found in package.json")
            else:
                print("[FAIL] viem MISSING from package.json")
        except Exception as e:
            print(f"[FAIL] Could not read package.json: {e}")
    else:
        print(f"[WARN] App package.json not found at {package_json}")

    # Check for Admin dashboard modifications
    admin_tsx = app_root / "app" / "(tabs)" / "admin.tsx"
    if admin_tsx.exists():
        content = admin_tsx.read_text(encoding="utf-8")
        if "Sovereign Agent" in content:
            print("[OK] admin.tsx contains Sovereign Agent UI")
        else:
            print("[FAIL] admin.tsx MISSING Sovereign Agent UI")
    else:
        print(f"[FAIL] admin.tsx not found at {admin_tsx}")

if __name__ == "__main__":
    check_server()
    check_app()
    print("\n--- VERIFICATION COMPLETE ---")
