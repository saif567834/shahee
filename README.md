# SHAHEE ORGANIC — Full-stack website
Node.js + Express + MongoDB. Website at `/`, admin dashboard at `/admin.html`.

## Run locally
1. Install Node 18+ and create a free MongoDB Atlas cluster (or local MongoDB).
2. `cp .env.example .env` and fill in `MONGODB_URI` and a strong `ADMIN_PASSWORD`.
3. `npm install && npm start` → http://localhost:3000

## Deploy (Render / Railway)
1. Push this folder to a GitHub repo.
2. Create a new Web Service: build `npm install`, start `npm start`.
3. Add env vars `MONGODB_URI` and `ADMIN_PASSWORD`. In Atlas, allow the host's IP (or 0.0.0.0/0).
4. Open your URL; admin is at `/admin.html`.

## How it works
- Checkout saves the order to MongoDB (prices recalculated on the server: 200 ml ₹499, 500 ml ₹999) and opens WhatsApp +91 9666977654.
- Admin: view orders, change status, add/remove gallery images (https image URLs). The website gallery shows them; with none added it shows poster crops.

## Not included yet
Online payment gateway (Razorpay etc. needs your merchant keys), brand video, real 3D model, admin sessions persist only until server restart.

## Razorpay online payments
1. Create a Razorpay account, then copy your Key ID and Key Secret (use Test keys first, from Dashboard > Account & Settings > API Keys).
2. Put them in `.env` (or your host's env vars) as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Never put the secret in the website files.
3. Flow: customer picks "Online payment (Razorpay)" → server creates the Razorpay order with the server-calculated total → Razorpay checkout opens → server verifies the payment signature → order becomes "New" with paymentStatus "Paid". Unpaid attempts stay as "Pending payment" in the admin.
4. Switch to Live keys after Razorpay approves your account.
