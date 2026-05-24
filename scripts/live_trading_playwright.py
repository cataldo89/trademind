from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:3005"
OUT_DIR = Path("C:/tmp/trademind-live-test")
OUT_DIR.mkdir(parents=True, exist_ok=True)

USER = {
    "id": "test-user",
    "email": "paper-trader@trademind.local",
    "aud": "authenticated",
    "role": "authenticated",
    "created_at": datetime.now(timezone.utc).isoformat(),
    "user_metadata": {"virtual_balance": 10000},
}

state = {
    "positions": [],
    "virtual_balance": 10000.0,
}


def wait_for_server(url: str, timeout_seconds: int = 60):
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        try:
            request = Request(url, method="HEAD")
            with urlopen(request, timeout=3) as response:
                if response.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(1)
    raise RuntimeError(f"Server did not become ready: {last_error}")


def start_next_server():
    env = os.environ.copy()
    env["NEXT_PUBLIC_SUPABASE_URL"] = ""
    env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = ""
    env["SUPABASE_SERVICE_ROLE_KEY"] = ""

    out = open(OUT_DIR / "next.out.log", "w", encoding="utf-8")
    err = open(OUT_DIR / "next.err.log", "w", encoding="utf-8")
    process = subprocess.Popen(
        ["npm.cmd", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3005"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        stdout=out,
        stderr=err,
        shell=False,
    )
    try:
        wait_for_server(BASE_URL)
        return process, out, err
    except Exception:
        process.terminate()
        out.close()
        err.close()
        raise


def json_response(route, payload, status=200):
    route.fulfill(
        status=status,
        content_type="application/json",
        body=json.dumps(payload),
        headers={
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        },
    )


def setup_mock_supabase(page):
    def handler(route):
        request = route.request
        url = request.url
        method = request.method
        parsed = urlparse(url)
        path = parsed.path

        if method == "OPTIONS":
            return json_response(route, {})

        if "/auth/v1/user" in url:
            return json_response(route, USER)

        if "/rest/v1/profiles" in url:
            if method in ("GET", "HEAD"):
                return json_response(route, {"virtual_balance": state["virtual_balance"]})
            return json_response(route, {"virtual_balance": state["virtual_balance"]})

        if "/rest/v1/signals" in url:
            return json_response(route, [])

        if "/rest/v1/positions" in url:
            if method == "GET":
                return json_response(route, state["positions"])
            if method == "POST":
                body = request.post_data_json
                if isinstance(body, list):
                    body = body[0]
                position = {
                    "id": f"pos-{len(state['positions']) + 1}",
                    "user_id": USER["id"],
                    "symbol": body.get("symbol", "SPY"),
                    "name": body.get("name") or body.get("symbol", "SPY"),
                    "market": body.get("market", "US"),
                    "quantity": float(body.get("quantity", 0)),
                    "entry_price": float(body.get("entry_price", 0)),
                    "entry_date": body.get("entry_date") or datetime.now(timezone.utc).date().isoformat(),
                    "currency": body.get("currency", "USD"),
                    "notes": body.get("notes"),
                    "status": "open",
                }
                state["positions"].insert(0, position)
                return json_response(route, [position], 201)
            if method == "PATCH":
                qs = parse_qs(parsed.query)
                pos_id = qs.get("id", [""])[0].replace("eq.", "")
                for pos in state["positions"]:
                    if pos["id"] == pos_id:
                        pos["status"] = "closed"
                state["positions"] = [pos for pos in state["positions"] if pos["status"] == "open"]
                return json_response(route, [])

        if path.endswith("/api/portfolio/trade"):
            body = request.post_data_json
            amount = float(body.get("amount") or 10)
            price = float(body.get("price") or 1)
            quantity = round(amount / price, 8)
            position = {
                "id": f"pos-{len(state['positions']) + 1}",
                "user_id": USER["id"],
                "symbol": body.get("symbol", "SPY"),
                "name": body.get("name") or body.get("symbol", "SPY"),
                "market": body.get("market", "US"),
                "quantity": quantity,
                "entry_price": price,
                "entry_date": datetime.now(timezone.utc).date().isoformat(),
                "currency": "USD",
                "notes": body.get("notes"),
                "status": "open",
            }
            state["positions"].insert(0, position)
            state["virtual_balance"] -= amount
            return json_response(
                route,
                {
                    "ok": True,
                    "data": {
                        "position": {
                            "id": position["id"],
                            "symbol": position["symbol"],
                            "market": "US",
                            "quantity": quantity,
                            "entryPrice": price,
                            "status": "open",
                        },
                        "profile": {"virtualBalance": state["virtual_balance"]},
                    },
                },
                201,
            )

        if path.endswith("/api/profile/virtual-balance"):
            return json_response(route, {"virtual_balance": state["virtual_balance"]})

        route.continue_()

    page.route("**/*", handler)


def screenshot(page, name):
    path = OUT_DIR / f"{name}.png"
    page.screenshot(path=str(path), full_page=True)
    return str(path)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def main():
    report = {"steps": [], "screenshots": [], "warnings": []}
    server, server_out, server_err = start_next_server()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 950})
            fake_session = {
                "access_token": "fake-access-token",
                "refresh_token": "fake-refresh-token",
                "expires_at": int(time.time()) + 3600,
                "expires_in": 3600,
                "token_type": "bearer",
                "user": USER,
            }
            context.add_init_script(
                f"""
                (() => {{
                  const session = {json.dumps(fake_session)};
                  localStorage.setItem('sb-demo-auth-token', JSON.stringify(session));
                  localStorage.setItem('supabase.auth.token', JSON.stringify(session));
                }})();
                """
            )
            page = context.new_page()
            page.on("console", lambda msg: report["warnings"].append(f"console:{msg.type}:{msg.text}") if msg.type in {"error", "warning"} else None)
            setup_mock_supabase(page)

            page.goto(f"{BASE_URL}/screener", wait_until="domcontentloaded")
            page.wait_for_selector("text=TradeMind Intelligence", timeout=30000)
            page.wait_for_timeout(8000)
            report["screenshots"].append(screenshot(page, "01-screener"))

            opportunity = page.locator("a", has_text="Ver an").first
            selected_card = clean_text(opportunity.inner_text(timeout=10000))
            opportunity.click()
            page.wait_for_url(re.compile(r".*/analysis\?symbol=.*"), timeout=20000)
            page.wait_for_selector("text=Indicadores", timeout=30000)
            page.wait_for_timeout(7000)
            report["steps"].append({"screener_opportunity": selected_card, "analysis_url": page.url})
            report["screenshots"].append(screenshot(page, "02-analysis"))

            signal_samples = []
            for label in ["1D", "5D", "1M"]:
                button = page.get_by_role("button", name=label).first
                if button.count() > 0:
                    button.click()
                    page.wait_for_timeout(2500)
                    save_button = page.get_by_role("button", name=re.compile(r"Guardar se", re.I)).first
                    buy_button = page.get_by_role("button", name=re.compile(r"(EJECUTAR COMPRA|COMPRA BLOQUEADA)", re.I)).first
                    signal_samples.append(
                        {
                            "range": label,
                            "save_button": clean_text(save_button.inner_text(timeout=5000)),
                            "buy_button": clean_text(buy_button.inner_text(timeout=5000)),
                        }
                    )

            report["steps"].append({"analysis_signal_variation": signal_samples})
            report["screenshots"].append(screenshot(page, "03-analysis-ranges"))

            buy_button = page.get_by_role("button", name=re.compile(r"EJECUTAR COMPRA FRACCIONAL", re.I)).first
            used_analysis_buy = False
            if buy_button.count() > 0 and buy_button.is_enabled():
                page.once("dialog", lambda dialog: dialog.accept("10"))
                buy_button.click()
                used_analysis_buy = True
                page.wait_for_timeout(2500)
            else:
                manual = page.get_by_role("link", name=re.compile(r"Ajustar y agregar", re.I)).first
                manual.click()

            if used_analysis_buy:
                page.goto(f"{BASE_URL}/portfolio", wait_until="domcontentloaded")
            page.wait_for_selector("text=Portafolio", timeout=30000)
            page.wait_for_timeout(5000)
            report["screenshots"].append(screenshot(page, "04-portfolio-before-manual"))

            if not state["positions"]:
                page.get_by_role("button", name=re.compile(r"Nueva posici", re.I)).click()
                page.locator('input[name="symbol"]').fill("SPY")
                page.wait_for_timeout(1000)
                price_value = page.locator('input[name="entryPrice"]').input_value()
                price = float(price_value) if price_value else 742.0
                quantity = round(10 / price, 8)
                page.locator('input[name="quantity"]').fill(str(quantity))
                page.locator('input[name="notes"]').fill("Prueba Playwright: capital simulado de 10 USD")
                page.get_by_role("button", name=re.compile(r"Agregar posici", re.I)).click()
                page.wait_for_timeout(4000)

            report["steps"].append({"trade_method": "analysis_fractional_buy" if used_analysis_buy else "portfolio_manual_fallback", "positions": state["positions"]})
            report["screenshots"].append(screenshot(page, "05-portfolio-position"))

            page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded")
            page.wait_for_selector("text=Dashboard", timeout=30000)
            page.wait_for_timeout(6000)
            dashboard_text = clean_text(page.locator("body").inner_text(timeout=10000))
            report["steps"].append(
                {
                    "dashboard_has_position_symbol": bool(state["positions"] and state["positions"][0]["symbol"] in dashboard_text),
                    "dashboard_excerpt": dashboard_text[:1000],
                }
            )
            report["screenshots"].append(screenshot(page, "06-dashboard"))

            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        server_out.close()
        server_err.close()

    print(json.dumps(report, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
