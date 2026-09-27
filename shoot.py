"""Screenshot run v4: the capture-first UX. Register fresh tenant, use the real
capture flow through the UI (type idea -> create), then shoot pipeline + record."""
import json, random, string, urllib.request, re
from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:8180"
BASE = "http://localhost:5173"
OUT = "/tmp/alleadz_shots"
stamp = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))

def call(path, body=None, token=None, tenant=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data,
                                 headers={"content-type": "application/json"})
    if token: req.add_header("authorization", f"Bearer {token}")
    if tenant: req.add_header("x-tenant-id", tenant)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

reg = call("/api/auth/register", {
    "email": f"pilot-{stamp}@alleadz.test",
    "password": f"Pilot-{stamp}-pass!",
    "workspaceName": "Meridian Advisory (demo)",
})
token = reg["token"]
tid = reg["tenant"]["id"] if isinstance(reg["tenant"], dict) else reg["tenant"]
print("tenant:", tid[:8])

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    page.goto(BASE, wait_until="networkidle")
    page.screenshot(path=f"{OUT}/10-login.png")

    page.evaluate(f"""
        localStorage.setItem('alleadz.token', {json.dumps(token)});
        localStorage.setItem('alleadz.tenant', localStorage.getItem('alleadz.tenant') || JSON.stringify({{"id": {json.dumps(tid)}, "name": "demo"}}));
    """) if page.url.startswith(BASE) else None
    page.goto(BASE, wait_until="networkidle")
    page.evaluate(f"""
        localStorage.setItem('alleadz.token', {json.dumps(token)});
        localStorage.setItem('alleadz.tenant', JSON.stringify({{"id": {json.dumps(tid)}, "name": "demo"}}));
    """)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/11-shell-empty.png")

    # open the capture modal — the one entry point
    page.click('button:has-text("I have an idea")')
    page.wait_for_timeout(400)
    page.fill(".capture-box textarea", "UAE ministry published an AI compute tender — their infrastructure office is the decision owner")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/12-capture-modal.png")
    page.click('.capture-box button:has-text("Create opportunity")')
    page.wait_for_timeout(9000)
    print("landed on:", page.url)
    page.screenshot(path=f"{OUT}/13-pipeline-record.png")

    # back to pipeline list
    page.wait_for_selector(".crumb", timeout=8000)
    page.click(".crumb")
    page.wait_for_timeout(5000)
    page.screenshot(path=f"{OUT}/14-pipeline-list.png")

    # companies dashboard
    page.click('a:has-text("Companies")')
    page.wait_for_timeout(6000)
    page.screenshot(path=f"{OUT}/15-companies.png")

    # add a person through the UI to populate People
    page.click('a:has-text("People")')
    page.wait_for_timeout(6000)
    page.click('button:has-text("+ Person")')
    page.fill('input[placeholder="Layla Haddad"]', "Omar Al-Farsi")
    selects = page.locator("select")
    # company select is the first select inside the form (index 0 = seniority? order: company, seniority, then email-class)
    page.select_option("form select >> nth=0", label="-") if False else None
    opts = page.locator('form select').first.locator("option")
    n = opts.count()
    if n > 1:
        val = opts.nth(1).get_attribute("value")
        page.select_option('form select >> nth=0', value=val)
    page.fill('input[placeholder="VP Infrastructure"]', "Director of Infrastructure")
    page.fill('input[placeholder="name@company.com"]', "omar@uaeministry.gov.ae")
    page.screenshot(path=f"{OUT}/16-person-form.png")
    page.click('form button:has-text("Create")')
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{OUT}/17-people.png")

    browser.close()
print("DONE", stamp)
