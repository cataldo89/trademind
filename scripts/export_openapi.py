import json
import sys
import os

# Aseguramos que Python encuentre el módulo quant-engine
script_dir = os.path.dirname(os.path.abspath(__file__))
quant_engine_dir = os.path.join(script_dir, "..", "quant-engine")
sys.path.append(quant_engine_dir)

from main import app

openapi_schema = app.openapi()

output_path = os.path.join(script_dir, "..", "openapi.json")
with open(output_path, "w") as f:
    json.dump(openapi_schema, f, indent=2)

print(f"OpenAPI schema successfully exported to {output_path}")
