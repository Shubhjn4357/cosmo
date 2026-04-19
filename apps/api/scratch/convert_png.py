from PIL import Image
import sys
import os

def convert_to_png(source_path, target_path):
    try:
        img = Image.open(source_path)
        img.save(target_path, "PNG")
        print(f"Successfully converted {source_path} to real PNG at {target_path}")
    except Exception as e:
        print(f"Error converting {source_path}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    assets_dir = r"d:\Code\whisper\cosmo\assets"
    files = ["icon.png", "splash.png", "adaptive-icon.png"]
    
    for f in files:
        path = os.path.join(assets_dir, f)
        if os.path.exists(path):
            convert_to_png(path, path)
        else:
            print(f"File not found: {path}")
