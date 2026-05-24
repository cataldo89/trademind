from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:3005"
OUT_DIR = Path(__file__).resolve().parents[1] / ".playwright-results" / "live-real"
OUT_DIR.mkdir(parents=True, exist_ok=True)
RUN_ID = str(int(time.time()))

EMAIL = f"playwright-{int(time.time())}@example.com"
PASSWORD = "Playwright123!"

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
    out = open(OUT_DIR / f"next-{RUN_ID}.out.log", "w", encoding="utf-8")
    err = open(OUT_DIR / f"next-{RUN_ID}.err.log", "w", encoding="utf-8")
    process = subprocess.Popen(
        ["npm.cmd", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3005"],
        cwd=Path(__file__).resolve().parents[1],
        env=os.environ.copy(),
        stdout=out,
        stderr=err,
        shell=False,
    )
    wait_for_server(BASE_URL)
    return process, out, err


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def shot(page, name):
    path = OUT_DIR / f"{name}.png"
    page.screenshot(path=str(path), full_page=True)
    return str(path)


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


def click_first(page, name_pattern: str, timeout=10000):
    locator = page.get_by_role("button", name=re.compile(name_pattern, re.I)).first
    locator.click(timeout=timeout)
    return locator


def main():
    report = {
        "user": EMAIL,
        "steps": [],
        "screenshots": [],
        "console": [],
    }
    server = server_out = server_err = None

    try:
        server, server_out, server_err = start_next_server()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 950})
            page = context.new_page()
            page.on(
                "console",
                lambda msg: report["console"].append(f"{msg.type}: {msg.text}")
                if msg.type in {"error", "warning"}
                else None,
            )
            proxy_supabase_requests(page)

            page.goto(f"{BASE_URL}/register", wait_until="domcontentloaded")
            page.fill('input[name="fullName"]', "Playwright Trader")
            page.fill('input[name="email"]', EMAIL)
            page.fill('input[name="password"]', PASSWORD)
            page.fill('input[name="confirmPassword"]', PASSWORD)
            click_first(page, r"Crear cuenta")
            try:
                page.wait_for_url(re.compile(r".*/login.*"), timeout=30000)
            except PlaywrightTimeoutError as exc:
                page.wait_for_timeout(2000)
                report["steps"].append({
                    "register": "blocked",
                    "url": page.url,
                    "body_excerpt": clean_text(page.locator("body").inner_text(timeout=5000))[:1500],
                })
                report["screenshots"].append(shot(page, "00-register-blocked"))
                print(json.dumps(report, indent=2, ensure_ascii=True))
                raise exc
            report["steps"].append({"register": "ok", "url": page.url})

            page.fill('input[name="email"]', EMAIL)
            page.fill('input[name="password"]', PASSWORD)
            click_first(page, r"Iniciar sesi")
            page.wait_for_url(re.compile(r".*/dashboard.*"), timeout=30000)
            page.wait_for_selector("text=Dashboard", timeout=30000)
            report["steps"].append({"login": "ok", "url": page.url})
            report["screenshots"].append(shot(page, "01-dashboard-after-login"))

            page.goto(f"{BASE_URL}/screener", wait_until="domcontentloaded")
            page.wait_for_selector("text=TradeMind Intelligence", timeout=30000)
            page.wait_for_timeout(9000)
            report["screenshots"].append(shot(page, "02-screener"))

            opportunity = page.locator("a", has_text=re.compile(r"Ver an", re.I)).first
            opportunity_text = clean_text(opportunity.inner_text(timeout=15000))
            opportunity.click()
            page.wait_for_url(re.compile(r".*/analysis\?symbol=.*"), timeout=30000)
            page.wait_for_selector("text=Indicadores", timeout=30000)
            page.wait_for_timeout(7000)
            report["steps"].append({"screener_opportunity": opportunity_text, "analysis_url": page.url})
            report["screenshots"].append(shot(page, "03-analysis"))

            signal_variants = []
            for label in ["1D", "5D", "1M"]:
                page.get_by_role("button", name=label).first.click(timeout=10000)
                page.wait_for_timeout(2500)
                save = page.get_by_role("button", name=re.compile(r"Guardar se", re.I)).first
                buy = page.get_by_role("button", name=re.compile(r"(EJECUTAR COMPRA|COMPRA BLOQUEADA)", re.I)).first
                signal_variants.append({
                    "range": label,
                    "save": clean_text(save.inner_text(timeout=10000)),
                    "buy": clean_text(buy.inner_text(timeout=10000)),
                    "buy_enabled": buy.is_enabled(),
                })
            report["steps"].append({"analysis_signal_variation": signal_variants})
            report["screenshots"].append(shot(page, "04-analysis-signal-variants"))

            buy = page.get_by_role("button", name=re.compile(r"EJECUTAR COMPRA FRACCIONAL", re.I)).first
            if buy.count() and buy.is_enabled():
                page.once("dialog", lambda dialog: dialog.accept("10"))
                buy.click()
                page.wait_for_timeout(5000)
                trade_method = "analysis_fractional_buy_10_usd"
            else:
                page.get_by_role("link", name=re.compile(r"Ajustar y agregar", re.I)).first.click()
                page.wait_for_selector("text=Portafolio", timeout=30000)
                page.get_by_role("button", name=re.compile(r"Nueva posici", re.I)).click()
                page.locator('input[name="symbol"]').fill("SPY")
                page.wait_for_timeout(1500)
                price_value = page.locator('input[name="entryPrice"]').input_value()
                price = float(price_value) if price_value else 742.0
                page.locator('input[name="quantity"]').fill(str(round(10 / price, 8)))
                page.locator('input[name="notes"]').fill("Prueba Playwright: compra simulada de 10 USD")
                click_first(page, r"Agregar posici")
                page.wait_for_timeout(5000)
                trade_method = "portfolio_manual_fallback_10_usd"

            page.goto(f"{BASE_URL}/portfolio", wait_until="domcontentloaded")
            page.wait_for_selector("text=Portafolio", timeout=30000)
            page.wait_for_timeout(7000)
            portfolio_text = clean_text(page.locator("body").inner_text(timeout=15000))
            report["steps"].append({
                "trade_method": trade_method,
                "portfolio_has_open_positions": "posiciones abiertas" in portfolio_text.lower() and "No tienes posiciones abiertas" not in portfolio_text,
                "portfolio_excerpt": portfolio_text[:1200],
            })
            report["screenshots"].append(shot(page, "05-portfolio-after-trade"))

            page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded")
            page.wait_for_selector("text=Dashboard", timeout=30000)
            page.wait_for_timeout(7000)
            dashboard_text = clean_text(page.locator("body").inner_text(timeout=15000))
            report["steps"].append({
                "dashboard_has_portfolio_data": "No tienes posiciones abiertas" not in dashboard_text,
                "dashboard_excerpt": dashboard_text[:1200],
            })
            report["screenshots"].append(shot(page, "06-dashboard-after-trade"))

            browser.close()
    finally:
        if server:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        if server_out:
            server_out.close()
        if server_err:
            server_err.close()

    print(json.dumps(report, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
