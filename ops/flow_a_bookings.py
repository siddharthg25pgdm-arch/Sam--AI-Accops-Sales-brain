"""Flow A "SAM - Bookings lead in": Bookings 'When a appointment is Created' -> POST to SAM with WEB_LEAD_SECRET.
usage: python flow_a.py create            -> creates it Stopped (prints id/state only)
       python flow_a.py patch <flowId>    -> re-PUT the definition (e.g. after rotating WEB_LEAD_SECRET)
The secret is read from ~/sam-accops/web/.env.local and goes only into the REST payload; it is never printed."""
import sys, json
sys.path.insert(0, r"C:\Users\Siddharth.gupta\Downloads\Accops-Ads-Analysis-2026")
import li_flows as L

NAME = "SAM - Bookings lead in"
MAILBOX = "AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com"
BOOKINGS_CONN = "shared-microsoftbook-ca459476"
PH = "__WEB_LEAD_SECRET__"
SECURE_IO = {"secureData": {"properties": ["inputs", "outputs"]}}

definition = {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {"$authentication": {"defaultValue": {}, "type": "SecureObject"},
                   "$connections": {"defaultValue": {}, "type": "Object"}},
    "triggers": {"When_a_appointment_is_Created": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {"host": {"apiId": "/providers/Microsoft.PowerApps/apis/shared_microsoftbookings",
                            "connectionName": "shared_microsoftbookings", "operationId": "CreateAppointment"},
                   "parameters": {"SMTPAddress": MAILBOX}},
        # the visitor's name, email and phone stay out of run history
        "runtimeConfiguration": {"secureData": {"properties": ["outputs"]}}}},
    "actions": {"Send_to_SAM": {
        "runAfter": {}, "type": "Http",
        # default retry policy: SAM answers 500 only when it could not store the lead; a repeat is deduped by email
        "inputs": {"method": "POST", "uri": "https://sam-accops.vercel.app/api/v1/leads/booking",
                   "headers": {"Authorization": f"Bearer {PH}", "Content-Type": "application/json"},
                   "body": "@triggerBody()"},
        "runtimeConfiguration": SECURE_IO}},
    "outputs": {}}
refs = {"shared_microsoftbookings": {"connectionName": BOOKINGS_CONN, "source": "Embedded",
                                     "id": "/providers/Microsoft.PowerApps/apis/shared_microsoftbookings", "tier": "NotSpecified"}}

secret = L.env_file(r"~/sam-accops/web/.env.local")["WEB_LEAD_SECRET"]
assert len(secret) >= 32, "WEB_LEAD_SECRET looks wrong"
body = json.loads(json.dumps(definition).replace(PH, secret))
props = {"definition": body, "connectionReferences": refs}
try:
    if sys.argv[1] == "create":
        j = L.api("POST", "", {"properties": {"displayName": NAME, "state": "Stopped", **props}})
    else:
        j = L.api("PATCH", f"/{sys.argv[2]}", {"properties": props})
    print(sys.argv[1], j["name"], j["properties"]["state"])
except SystemExit as e:   # L.api exits with the response text; scrub the secret before showing it
    print(str(e).replace(secret, "<secret>"))
