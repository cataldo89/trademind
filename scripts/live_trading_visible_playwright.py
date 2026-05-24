from __future__ import annotations

import re
import os
import socket
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


PORT = os.environ.get("TRADEMIND_PLAYWRIGHT_PORT", "3000")
BASE_URL = os.environ.get("TRADEMIND_BASE_URL", f"http://localhost:{PORT}")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / ".playwright-results" / "visible"
OUT_DIR.mkdir(parents=True, exist_ok=True)

_original_getaddrinfo = socket.getaddrinfo


def patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if host == "agtgecjoobuilgabwrbo.supabase.co":
        return [
            (socket.AF_INET, socket.SOCK_STREAM, proto or 6, "", ("104.18.38.10", port)),
            (socket.AF_INET, socket.SOCK_STREAM, proto or 6, "", ("172.64.149.246", port)),
        ]
    return _original_getaddrinfo(host, port, family, type, proto, flags)


socket.getaddrinfo = patched_getaddrinfo


def wait_for_server(url: str, timeout_seconds: int = 90):
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        try:
            with urlopen(Request(url, method="HEAD"), timeout=3) as response:
                if response.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(1)
    raise RuntimeError(f"Next server did not become ready: {last_error}")


def start_next_server():
    try:
      wait_for_server(BASE_URL, timeout_seconds=3)
      return None, None, None
    except RuntimeError:
      pass

    run_id = str(int(time.time()))
    out = open(OUT_DIR / f"next-{run_id}.out.log", "w", encoding="utf-8")
    err = open(OUT_DIR / f"next-{run_id}.err.log", "w", encoding="utf-8")
    process = subprocess.Popen(
        ["npm.cmd", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", PORT],
        cwd=ROOT,
        stdout=out,
        stderr=err,
        shell=False,
    )
    wait_for_server(BASE_URL)
    return process, out, err


def add_visible_position(page, symbol: str, quantity: str):
    page.goto(f"{BASE_URL}/portfolio", wait_until="domcontentloaded")
    page.wait_for_selector("text=Portafolio", timeout=30000)
    page.wait_for_timeout(2000)

    try_click(page.get_by_role("button", name=re.compile(r"Nueva posici", re.I)).first)
    page.locator('input[name="symbol"]').fill(symbol)
    page.wait_for_timeout(2500)

    page.locator('input[name="quantity"]').fill(quantity)
    page.locator('input[name="notes"]').fill(f"Demo visible: {quantity} acciones simuladas de {symbol}")
    try_click(page.get_by_role("button", name=re.compile(r"Agregar posici", re.I)).first)
    page.wait_for_timeout(6000)


def try_click(locator, timeout=6000):
    try:
        locator.click(timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def proxy_supabase_requests(page):
    def handler(route):
        request = route.request
        if request.method == "OPTIONS":
            route.fulfill(
                status=204,
                headers={
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
                    "access-control-allow-headers": "*",
                },
                body="",
            )
            return

        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower()
            not in {
                "host",
                "origin",
                "referer",
                "sec-fetch-dest",
                "sec-fetch-mode",
                "sec-fetch-site",
                "sec-ch-ua",
                "sec-ch-ua-mobile",
                "sec-ch-ua-platform",
                "accept-encoding",
                "content-length",
            }
        }
        body = request.post_data.encode("utf-8") if request.post_data else None
        upstream = Request(request.url, data=body, headers=headers, method=request.method)

        try:
            with urlopen(upstream, timeout=30) as response:
                payload = response.read()
                response_headers = dict(response.headers.items())
                response_headers["access-control-allow-origin"] = "*"
                response_headers["access-control-expose-headers"] = "*"
                route.fulfill(status=response.status, headers=response_headers, body=payload)
        except HTTPError as error:
            payload = error.read()
            response_headers = dict(error.headers.items())
            response_headers["access-control-allow-origin"] = "*"
            response_headers["access-control-expose-headers"] = "*"
            route.fulfill(status=error.code, headers=response_headers, body=payload)

    page.route("https://*.supabase.co/**", handler)


def main():
    server = server_out = server_err = None
    try:
        server, server_out, server_err = start_next_server()
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=False,
                slow_mo=700,
                args=["--start-maximized"],
            )
            context = browser.new_context(no_viewport=True)
            page = context.new_page()
            proxy_supabase_requests(page)

            # 1. Dashboard/login state
            page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

            if re.search(r"/login", page.url):
                email = os.environ.get("TRADEMIND_LOGIN_EMAIL")
                password = os.environ.get("TRADEMIND_LOGIN_PASSWORD")
                if email and password:
                    page.locator('input[type="email"]').fill(email)
                    page.locator('input[type="password"]').fill(password)
                    try_click(page.get_by_role("button", name=re.compile(r"Iniciar sesi", re.I)).first)
                else:
                    print("La app pidio login. Inicia sesion manualmente en la ventana de Chromium.")
                page.wait_for_url(re.compile(r".*/dashboard.*"), timeout=180000)

            if os.environ.get("TRADEMIND_VISIBLE_MODE") == "nvda-dashboard":
                add_visible_position(
                    page,
                    os.environ.get("TRADEMIND_DEMO_SYMBOL", "NVDA"),
                    os.environ.get("TRADEMIND_DEMO_QUANTITY", "10"),
                )
                page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded")
                page.wait_for_selector("text=Dashboard", timeout=30000)
                page.wait_for_timeout(10 * 60 * 1000)
                browser.close()
                return

            # 2. Screener: find opportunity
            page.goto(f"{BASE_URL}/screener", wait_until="domcontentloaded")
            page.wait_for_selector("text=TradeMind Intelligence", timeout=30000)
            page.wait_for_timeout(9000)

            opportunity = page.locator("a", has_text=re.compile(r"Ver an", re.I)).first
            opportunity.click(timeout=15000)

            # 3. Analysis: vary signal/ranges
            page.wait_for_url(re.compile(r".*/analysis\?symbol=.*"), timeout=30000)
            page.wait_for_selector("text=Indicadores", timeout=30000)
            page.wait_for_timeout(5000)

            for label in ["1D", "5D", "1M"]:
                try_click(page.get_by_role("button", name=label).first)
                page.wait_for_timeout(2500)

            # 4. Try simulated 10 USD buy from analysis if signal allows it
            buy = page.get_by_role("button", name=re.compile(r"EJECUTAR COMPRA FRACCIONAL", re.I)).first
            try:
                if buy.count() and buy.is_enabled():
                    page.once("dialog", lambda dialog: dialog.accept("10"))
                    buy.click(timeout=10000)
                    page.wait_for_timeout(5000)
            except PlaywrightTimeoutError:
                pass

            # 5. Portfolio: show/add manual fallback if needed
            page.goto(f"{BASE_URL}/portfolio", wait_until="domcontentloaded")
            page.wait_for_selector("text=Portafolio", timeout=30000)
            page.wait_for_timeout(5000)

            body = page.locator("body").inner_text(timeout=10000)
            if "No tienes posiciones abiertas" in body:
                try_click(page.get_by_role("button", name=re.compile(r"Nueva posici", re.I)).first)
                page.locator('input[name="symbol"]').fill("SPY")
                page.wait_for_timeout(2000)
                price_value = page.locator('input[name="entryPrice"]').input_value()
                price = float(price_value) if price_value else 742.0
                quantity = round(10 / price, 8)
                page.locator('input[name="quantity"]').fill(str(quantity))
                page.locator('input[name="notes"]').fill("Demo visible Playwright: compra simulada de 10 USD")
                try_click(page.get_by_role("button", name=re.compile(r"Agregar posici", re.I)).first)
                page.wait_for_timeout(6000)

            # 6. Dashboard: final view
            page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded")
            page.wait_for_selector("text=Dashboard", timeout=30000)
            page.wait_for_timeout(5000)

            print("Prueba visible terminada. Dejo el navegador abierto 5 minutos para inspeccion visual.")
            page.wait_for_timeout(5 * 60 * 1000)
            browser.close()
    finally:
        if server:
            server.terminate()
        if server_out:
            server_out.close()
        if server_err:
            server_err.close()


if __name__ == "__main__":
    main()
