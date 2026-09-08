# Brandville Vault

Private watch catalog — agents post, dealers browse.

---

## Setup

### 1. Set your WhatsApp number
Open `.env` and replace `REACT_APP_WHATSAPP_NUMBER` with your WhatsApp business number in international format (no + or spaces). Example: `447911123456` for a UK number.

### 2. Deploy to Vercel

1. Go to vercel.com and create a free account
2. Click "Add New Project"
3. Upload this folder (or connect a GitHub repo)
4. Under "Environment Variables", add:
   - `REACT_APP_SUPABASE_URL` = your Supabase project URL
   - `REACT_APP_SUPABASE_ANON_KEY` = your Supabase anon key
   - `REACT_APP_WHATSAPP_NUMBER` = your WhatsApp number
5. Click Deploy

### 3. Create your admin account

1. Go to your live app URL
2. Go to Supabase dashboard → Authentication → Users → "Invite user"
3. Enter your own email — you'll get a setup email
4. After setting your password and logging in, go to Supabase → Table Editor → profiles
5. Find your row and change `role` from `dealer` to `admin`
6. Refresh the app — you now have full admin access

### 4. Invite dealers and agents

In the app as admin → Admin panel → Invite user tab:
- Enter their email and select their role
- Also go to Supabase → Authentication → Users → Invite user and enter the same email (this sends the actual email with a password setup link)

---

## User roles

| Role | Can do |
|------|--------|
| Admin | Everything — manage users, post watches, browse catalog |
| Agent | Post watches, manage their own listings |
| Dealer | Browse catalog, reserve watches, WhatsApp inquiry, share |

---

## File structure

```
src/
  pages/
    Login.js          — Login screen (all users)
    DealerCatalog.js  — Catalog grid with filters (dealers + admin)
    WatchDetail.js    — Single watch page with actions
    AgentListings.js  — Post new + manage listings (agents + admin)
    AdminPanel.js     — Manage users, stats (admin only)
  components/
    Topbar.js         — Navigation bar
  context/
    AuthContext.js    — Auth state and session
  lib/
    supabase.js       — Supabase client
```
