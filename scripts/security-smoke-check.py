from pathlib import Path
import re
admin = Path("admin.html").read_text(encoding="utf-8")
retailer = Path("retailer.html").read_text(encoding="utf-8")
public = Path("index.html").read_text(encoding="utf-8")
master_sql = Path("supabase/master-control-system.sql").read_text(encoding="utf-8")
storage_sql = Path("supabase/setup-medicine-storage.sql").read_text(encoding="utf-8")

def require(condition, message):
    if not condition:
        raise SystemExit("SECURITY CHECK FAILED: " + message)
    print("PASS: " + message)

ids = re.findall(r'ADMIN_ID\\s*=\\s*["\\']([^"\\']+)', admin + "\\n" + retailer)
require(len(ids) == 2 and len(set(ids)) == 1, "Admin UUID is consistent in Admin and Retailer Portal")
require(ids[0] in master_sql and ids[0] in storage_sql, "Admin UUID matches settings/audit and storage SQL policies")
require("sb_publishable_" in admin and "sb_publishable_" in retailer and "sb_publishable_" in public,
        "Browser pages use publishable Supabase key")
for name, source in [("admin.html", admin), ("retailer.html", retailer), ("index.html", public)]:
    require("service_role" not in source.lower() and "sb_secret_" not in source.lower(),
            name + " contains no service-role/secret key")
require('currentUser.id!==ADMIN_ID' in admin, "Admin dashboard checks the signed-in user ID before revealing controls")
require('auth.uid()' in master_sql and 'Admin can manage site settings' in master_sql,
        "Master settings SQL includes database-side authenticated admin policy")
require('auth.uid()' in storage_sql and 'PRAVEEN admin upload medicine photos' in storage_sql,
        "Medicine storage writes are restricted by database policy")
require('eq("retailer_id",user.id)' in retailer, "Retailer order history is filtered to the signed-in retailer")
require('retailer_id:user.id' in retailer, "New orders are associated with the signed-in retailer")
require('approval_status==="approved"' in retailer, "Retailer ordering requires approved profile in the UI")
require('signInWithPassword' in admin and 'signOut()' in admin, "Admin login and logout handlers are present")
require('signInWithPassword' in retailer and 'signOut()' in retailer, "Retailer login and logout handlers are present")
require('signInWithPassword' not in public and 'orders' not in public.lower(), "Public website remains information-only")
require('admin_activity_logs' in master_sql and 'enable row level security' in master_sql.lower(),
        "Admin activity log table has RLS enabled in migration")
print("Static security smoke checks passed. These checks do not replace live Supabase RLS/MFA tests.")
