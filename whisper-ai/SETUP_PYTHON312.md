# Python 3.12 Setup for Whisper AI

## Quick Start

### 1. Download & Install Python 3.12
1. Go to: https://www.python.org/downloads/
2. Download **Python 3.12.7** (latest 3.12.x version)
3. Run installer
4. ✅ Check "Add Python 3.12 to PATH"
5. Click "Install Now"

### 2. Verify Installation
```powershell
python --version
# Should show: Python 3.12.x
```

### 3. Create Virtual Environment
```powershell
cd d:\Code\whisper\whisper-ai

# Create venv with Python 3.12
python -m venv venv312

# Activate it
.\venv312\Scripts\Activate.ps1

# Verify you're using venv
python --version  # Should still be 3.12.x
```

### 4. Install All Dependencies
```powershell
# Make sure venv is activated (you'll see (venv312) in prompt)
pip install --upgrade pip
pip install -r requirements.txt
```

### 5. Start Backend
```powershell
# In venv312
python -m uvicorn api.route:app --reload --host 0.0.0.0 --port 8000
```

### 6. Test Auth
Open: `d:\Code\whisper\auth-test.html` in browser

---

## Alternative: Use py launcher

If you have multiple Python versions:

```powershell
# Check available versions
py --list

# Use Python 3.12 specifically
py -3.12 -m venv venv312
.\venv312\Scripts\Activate.ps1
pip install -r requirements.txt
```

---

## Troubleshooting

### "python: command not found"
- Reinstall Python 3.12 and CHECK "Add to PATH"
- Or use: `py -3.12` instead of `python`

### "Scripts\Activate.ps1 cannot be loaded"
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Still getting Python 3.14?
```powershell
# Specify full path
C:\Python312\python.exe -m venv venv312
```

---

## Success Checklist
- [ ] Python 3.12 installed
- [ ] Virtual environment created
- [ ] Dependencies installed without errors
- [ ] Backend starts without errors
- [ ] Can see "✅ Supabase client initialized" in logs
- [ ] Auth test page can signup/login
