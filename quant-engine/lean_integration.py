import subprocess
import os
from dotenv import load_dotenv

load_dotenv()

QC_USER_ID = os.getenv("QC_USER_ID")
QC_API_TOKEN = os.getenv("QC_API_TOKEN")

def export_to_lean(symbol: str, parameters: dict, output_path: str = "./lean_algorithms"):
    # Generate a C# or Python QCAlgorithm class based on calibrated parameters
    algorithm_template = f"""
from AlgorithmImports import *

class TradeMindExportedAlgorithm(QCAlgorithm):
    def Initialize(self):
        self.SetStartDate(2023, 1, 1)
        self.SetCash(100000)
        self.AddEquity("{symbol}", Resolution.Daily)
        
        # Calibrated Parameters
        self.rsi_period = {parameters.get('rsi_period', 14)}
        self.var_threshold = {parameters.get('var_threshold', 0.05)}

    def OnData(self, data):
        if not self.Portfolio.Invested:
            self.SetHoldings("{symbol}", 1)
"""
    os.makedirs(output_path, exist_ok=True)
    file_name = f"{output_path}/{symbol}_algorithm.py"
    with open(file_name, "w") as f:
        f.write(algorithm_template)
        
    return file_name

def run_lean_backtest(algorithm_file: str):
    try:
        # P0.5: Ejecutar lean whoami si Lean CLI está instalado.
        result = subprocess.run(["lean", "whoami"], capture_output=True, text=True, check=True)
        return {"status": "success", "message": "Lean CLI is installed and authenticated.", "output": result.stdout.strip()}
    except FileNotFoundError:
        return {"status": "error", "message": "Lean CLI is not installed or not in PATH."}
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": f"Lean CLI error. Output: {e.output}"}
    except Exception as e:
        return {"status": "error", "message": f"Unexpected error running Lean: {str(e)}"}
