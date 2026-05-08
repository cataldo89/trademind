import os

def clean_file(path):
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            
        clean_lines = []
        changed = False
        for line in lines:
                changed = True
                continue
            clean_lines.append(line)
            
        if changed:
            with open(path, 'w', encoding='utf-8') as f:
                f.writelines(clean_lines)
    except Exception as e:
        print(f"Error {path}: {e}")

for root, dirs, files in os.walk('.'):
    if 'node_modules' in root or '.git' in root or '.next' in root or 'venv' in root:
        continue
    for file in files:
        if file.endswith(('.ts', '.tsx', '.json', '.js', '.mjs', '.md', '.py')):
            clean_file(os.path.join(root, file))
