@echo off
echo Starting TradeMind Quant Engine...
echo Make sure .env file is configured with QC_API_TOKEN and QC_USER_ID
echo.
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
