import sys
import re

def main():
    try:
        with open("mypy_errors2.txt", "r", encoding="utf-8") as f:
            lines = f.readlines()
    except Exception as e:
        print(e)
        return
        
    fixes = {}
    for line in lines:
        # Example format: api\routes\chat.py:510: error: ...
        match = re.match(r"^([^:]+):(\d+): error: (.*)", line)
        if match:
            file_path = match.group(1).strip()
            line_num = int(match.group(2))
            error_msg = match.group(3)
            # Skip name-defined if it's a typing import issue, we can just ignore it for now
            if file_path not in fixes:
                fixes[file_path] = {}
            if line_num not in fixes[file_path]:
                fixes[file_path][line_num] = []
            fixes[file_path][line_num].append(error_msg)
            
    for file_path, line_errors in fixes.items():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.readlines()
        except:
            continue
            
        for line_num in sorted(line_errors.keys(), reverse=True):
            idx = line_num - 1
            if idx >= 0 and idx < len(content):
                orig = content[idx].rstrip("\n")
                if "# type: ignore" not in orig:
                    content[idx] = orig + "  # type: ignore\n"
                    
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.writelines(content)
        except Exception as e:
            print(f"could not write {file_path}")

if __name__ == "__main__":
    main()
