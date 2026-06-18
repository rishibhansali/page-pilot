# Manual smoke test — run this while the server is up to verify the /navigate endpoint.
import json
import urllib.request

payload = json.dumps({
    "tab_id": "test-tab-001",
    "url": "https://github.com",
    "user_message": "go to the pricing page",
    "dom_skeleton": (
        "[button] \"Platform\" [data-pagepilot-id='pp-3']\n"
        "[link] \"Pricing\" /pricing\n"
        "[link] \"Sign in\" /login\n"
        "[button] \"Sign up\" [data-pagepilot-id='pp-9']"
    ),
}).encode()

req = urllib.request.Request(
    "http://localhost:8000/api/navigate",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(req) as resp:
    body = json.loads(resp.read())

print(json.dumps(body, indent=2))
