# Putting are-you-a-geni.us live (step by step)

Three free accounts, about 20 minutes. You'll need three things open:
* `deploy/render-secrets.env` in this folder (it holds `TREASURY_SECRET_KEY` and `ADMIN_KEY`; it is gitignored, so it's only on your Mac)
* a notes app to hold your MongoDB password for a minute
* your GoDaddy login

> The treasury has no devnet SOL, so the site's "Get test SOL" button copies the visitor's wallet address and points them to faucet.solana.com, and resolving markets can't pay out. Everything else works: markets, live odds, search, receipts, leaderboard. Anyone with devnet SOL in Phantom can bet for real, and the demo video shows the full flow.

---

## Part 1: MongoDB Atlas (database), about 7 min

1. Go to **https://cloud.mongodb.com** and click **Sign up** → **Sign up with GitHub** (or Google). Answer the short survey however you like.
2. You'll land on **Deploy your cluster**. Choose:
   * **M0 (Free)**
   * Provider **AWS**, region **N. Virginia (us-east-1)** (Render's default region is Oregon, but any US region is fine)
   * Name: leave **Cluster0**
   * Click **Create Deployment**.
3. A **Connect to Cluster0** window opens.
   * **Create a database user:** the username is pre-filled. Click **Copy** next to the generated password and paste it into your notes app. Click **Create Database User**.
   * Click **Choose a connection method** → **Drivers**. Leave Node.js / latest version.
   * Copy the **connection string**. It looks like `mongodb+srv://USERNAME:<db_password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`.
   * Paste it into your notes and **replace `<db_password>` (including the `< >`) with the password you copied.** This finished string is your `MONGODB_URI`. Keep it private.
   * Click **Close**.
4. Allow Render to reach the database. In the left sidebar: **Security → Network Access** (newer UI: **Database & Network Access → IP Access List**) → **Add IP Address** → **Allow access from anywhere** (fills in `0.0.0.0/0`) → **Confirm**. Wait until its status says **Active**.

That's all for Atlas. The app creates its own collections, time series collection and Atlas Search index on first boot.

---

## Part 2: Render (hosting), about 8 min

1. Go to **https://dashboard.render.com** → **Sign in with GitHub** (use the account that owns `snr2753423/are-you-a-geni.us`). Authorize Render.
2. Click **+ New** (top right) → **Blueprint**.
3. Under **Connect a repository**, if `are-you-a-geni.us` isn't listed, click **Configure account / GitHub**, give Render access to that repo (or all repos), and come back. Click **Connect** next to `snr2753423/are-you-a-geni.us`.
4. **Blueprint Name:** `are-you-a-geni-us`. Branch: `main`. Render reads `render.yaml` and shows one web service, **are-you-a-geni-us** (Free plan).
5. It asks for three secret values:
   * `MONGODB_URI` → your finished Atlas string from Part 1.
   * `TREASURY_SECRET_KEY` → open `deploy/render-secrets.env`, copy everything after `TREASURY_SECRET_KEY=` (the whole `[236,78,...]` list, including the brackets).
   * `ADMIN_KEY` → copy everything after `ADMIN_KEY=` in the same file. This is the password for `/admin.html`.
6. Click **Deploy Blueprint** (or **Apply**). Open the service and watch **Logs**. In about 2–4 minutes you should see:
   ```
   Seeded 8 new markets
   [atlas] created time series collection price_ticks
   [atlas] creating Atlas Search index markets_search
   [atlas] change stream open on trades + markets
   are-you-a-geni.us on http://localhost:10000
   ```
   and the status turns **Live**. If you see `MongoServerSelectionError` or `bad auth`, re-check the password inside `MONGODB_URI` and the `0.0.0.0/0` access rule.
7. Click the **https://are-you-a-geni-us.onrender.com** link at the top (the exact name may differ slightly) and check that the markets load.

---

## Part 3: Connect the domain, about 5 min + DNS wait

**In Render:**
1. Open the service → **Settings** → scroll to **Custom Domains** → **+ Add Custom Domain** → type `are-you-a-geni.us` → **Save**.
2. Render adds `are-you-a-geni.us` and usually `www.are-you-a-geni.us` too (if not, add it the same way). Each shows **DNS instructions**. Note them:
   * for `are-you-a-geni.us`: an **A** record pointing to an IP (Render's is usually `216.24.57.1`)
   * for `www.are-you-a-geni.us`: a **CNAME** pointing to `are-you-a-geni-us.onrender.com`

**In GoDaddy:**
3. Go to **https://dcc.godaddy.com/control/portfolio** (or godaddy.com → your name → **My Products**). Find **are-you-a-geni.us** → click **DNS** (or the ⋯ menu → **Edit DNS**).
4. On the **DNS Records** tab:
   * Find the **A** record with Name **@** (value is often "Parked" or a GoDaddy IP). Click the pencil ✏️ → set **Value** to Render's IP (e.g. `216.24.57.1`), TTL **1/2 Hour** → **Save**. If there are several `A @` records, delete the extra ones.
   * Find the **CNAME** record with Name **www** (value is often `@`). Click ✏️ → set **Value** to `are-you-a-geni-us.onrender.com` → **Save**. If there's no `www` record, **Add New Record** → Type CNAME, Name `www`, Value as above.
   * If there's an **AAAA** record for `@`, delete it (Render doesn't use IPv6 here).
5. Still in GoDaddy, open the **Forwarding** tab (or **Domain → Forwarding**) and make sure **no forwarding** is set for the domain. Forwarding would override the DNS records.

**Back in Render:**
6. In **Custom Domains**, click **Verify** next to each domain. It can take 5–60 minutes for DNS to spread. Once verified, Render issues the HTTPS certificate automatically (another few minutes).
7. Open **https://are-you-a-geni.us**. 🎉

---

## Part 4: Before judging

* Render's free plan sleeps after 15 idle minutes, and the next visit takes about a minute to wake it. **Open the site a few minutes before judges look at it.** (Upgrading the service to **Starter**, $7/mo, removes this.)
* On Devpost: put `https://are-you-a-geni.us` in **Try it out** and in the GoDaddy Registry **domain question**, and **tick all three MLH prizes**.
* `/admin.html` + your `ADMIN_KEY` resolves markets. It can't pay out while the treasury is empty, so leave the markets open.
