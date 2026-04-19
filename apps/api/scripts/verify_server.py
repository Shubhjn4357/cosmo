#!/usr/bin/env python3
"""
Verification script for Cosmo AI server module structure.
Attempts to import all core modules to ensure no missing dependencies or SyntaxErrors.
"""

import sys
import os
import importlib
import pkgutil
from pathlib import Path

def verify_imports():
    print(">>> Starting Cosmo AI Module Verification <<<")
    
    # Add the current directory to sys.path to ensure modules can be found
    current_dir = str(Path(__file__).parent.parent.absolute())
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)
        
    os.chdir(current_dir)
    print(f"Working Directory: {os.getcwd()}")
    
    modules_to_verify = [
        "api.route",
        "api.routes.auth",
        "api.routes.admin",
        "api.routes.chat",
        "utils.app_paths",
        "services.runtime_manager",
        "model.tokenizer"
    ]
    
    fail_count = 0
    
    print("\n--- Phase 1: Explicit Core Modules ---")
    for mod_name in modules_to_verify:
        try:
            importlib.import_module(mod_name)
            print(f"[OK] {mod_name}")
        except Exception as e:
            print(f"[FAIL] {mod_name} - {e}")
            fail_count += 1
            
    print("\n--- Phase 2: Recursive Package Scanning ---")
    packages = ["api", "services", "utils", "model", "knowledge"]
    for pkg in packages:
        print(f"Scanning package: {pkg}...")
        try:
            pkg_path = os.path.join(current_dir, pkg)
            if not os.path.exists(pkg_path):
                print(f"  [SKIP] {pkg} (directory not found)")
                continue
                
            optional_deps = ["google", "cryptography", "bs4", "faiss", "psutil", "torch", "sse_starlette", "openai"]
            for _, name, is_pkg in pkgutil.walk_packages([pkg_path], prefix=f"{pkg}."):
                try:
                    importlib.import_module(name)
                    print(f"  [OK] {name}")
                except Exception as e:
                    # Treat missing optional dependencies as warnings
                    if any(dep in str(e) for dep in optional_deps):
                        print(f"  [WARN] {name} - Warning: {e}")
                    else:
                        print(f"  [FAIL] {name} - CRITICAL: {e}")
                        fail_count += 1
        except Exception as e:
            print(f"[ERROR] scanning {pkg}: {e}")
            fail_count += 1

    print("\n--- Phase 3: Fast API App Initialization ---")
    try:
        from api.route import app
        print("[OK] FastAPI app object created successfully.")
    except Exception as e:
        print(f"[FAIL] Failed to create FastAPI app: {e}")
        fail_count += 1

    if fail_count == 0:
        print("\n*** ALL MODULES VERIFIED SUCCESSFULLY ***")
        sys.exit(0)
    else:
        print(f"\nTotal failures: {fail_count}")
        sys.exit(1)

if __name__ == "__main__":
    verify_imports()
