
require("node:dns").setServers(["1.1.1.1", "8.8.8.8"]);
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rl = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });

const Order = mongoose.model("Order", new mongoose.Schema({
  name: String,
  phone: String,
  address: String,
  payment: String,
  items: [{ s: Number, q: Number }],
  total: Number,
  status: { type: String, default: "New" },
  trackingNumber: { type: String, default: "" },
  courier: { type: String, default: "" },
  trackingUrl: { type: String, default: "" },
  adminNote: { type: String, default: "" },
  paymentStatus: String,
  rzpOrderId: String,
  rzpPaymentId: String
}, { timestamps: true }));

const Gallery = mongoose.model("Gallery", new mongoose.Schema({
  imageUrl: String,
  caption: String,
  link: String
}, { timestamps: true }));

const PRICE = { 200: 499, 500: 999 };
const tokens = new Set();

const auth = (q, s, n) =>
  tokens.has((q.headers.authorization || "").replace("Bearer ", ""))
    ? n()
    : s.status(401).json({ error: "Unauthorized" });

const str = (v, m) => String(v || "").trim().slice(0, m);

// CUSTOMER ORDERS
app.post("/api/orders", rl({ windowMs: 60000, max: 10 }), async (q, s) => {
  try {
    const items = (Array.isArray(q.body.items) ? q.body.items : [])
      .filter(i => PRICE[i.s] && i.q > 0 && i.q < 100)
      .map(i => ({ s: +i.s, q: Math.floor(+i.q) }));

    const name = str(q.body.name, 80);
    const phone = str(q.body.phone, 20);
    const address = str(q.body.address, 300);

    if (!items.length || !name || !phone || !address) {
      return s.status(400).json({ error: "Invalid order" });
    }

    const total = items.reduce((a, i) => a + PRICE[i.s] * i.q, 0);
    const online = /razorpay/i.test(str(q.body.payment, 60));

    if (!online) {
      const o = await Order.create({
        name, phone, address,
        payment: "Cash on Delivery",
        items, total
      });
      return s.json({ ok: true, id: o._id, trackingNumber: o.trackingNumber });
    }

    const { RAZORPAY_KEY_ID: k, RAZORPAY_KEY_SECRET: sec } = process.env;

    if (!k || !sec) {
      return s.status(503).json({
        error: "Online payment not configured"
      });
    }

    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(k + ":" + sec).toString("base64")
      },
      body: JSON.stringify({
        amount: total * 100,
        currency: "INR",
        receipt: "shahee_" + Date.now()
      })
    });

    const rz = await r.json();

    if (!r.ok) {
      return s.status(502).json({ error: "Payment provider error" });
    }

    const o = await Order.create({
      name, phone, address,
      payment: "Online (Razorpay)",
      items, total,
      status: "Pending payment",
      paymentStatus: "Created",
      rzpOrderId: rz.id
    });

    s.json({
      ok: true,
      id: o._id,
      rzp: { orderId: rz.id, amount: rz.amount, key: k }
    });

  } catch (e) {
    console.error(e);
    s.status(500).json({ error: "Server error" });
  }
});

// CUSTOMER ORDER TRACKING: phone number only.
app.get("/api/track/orders", rl({ windowMs: 60000, max: 10 }), async (q, s) => {
  try {
    const phone = str(q.query.phone, 20).replace(/\D/g, "");
    if (phone.length < 10) {
      return s.status(400).json({ error: "Enter the 10-digit phone number used at checkout." });
    }
    const orders = await Order.find().sort("-createdAt").limit(500).lean();
    const matches = orders.filter(o => String(o.phone || "").replace(/\D/g, "") === phone);
    return s.json({
      orders: matches.map(o => ({
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        orderStatus: o.status || "New",
        paymentMethod: /cash on delivery/i.test(o.payment || "") ? "Cash on delivery" : "Online",
        paymentStatus: o.paymentStatus || "Pending",
        items: (o.items || []).map(i => ({
          name: `${i.s} ml`,
          qty: i.q
        })),
        amount: o.total,
        courierName: o.courier || "",
        trackingNumber: o.trackingNumber || "",
        trackingUrl: o.trackingUrl || "",
        shippingNotes: o.adminNote || ""
      }))
    });
  } catch (e) {
    console.error("Phone tracking error:", e);
    return s.status(500).json({ error: "Unable to retrieve orders right now." });
  }
});

// CUSTOMER ORDER TRACKING: requires both order ID and the phone number used at checkout.
app.get("/api/track", rl({ windowMs: 60000, max: 20 }), async (q, s) => {
  try {
    const id = str(q.query.orderId, 40);
    const phone = str(q.query.phone, 20).replace(/\\s+/g, "");
    if (!mongoose.isValidObjectId(id) || !phone) {
      return s.status(400).json({ error: "Enter a valid order ID and phone number." });
    }
    const order = await Order.findById(id).lean();
    if (!order || String(order.phone || "").replace(/\\s+/g, "") !== phone) {
      return s.status(404).json({ error: "Order not found. Check the order ID and phone number." });
    }
    return s.json({
      orderId: String(order._id),
      createdAt: order.createdAt,
      status: order.status,
      payment: order.payment,
      paymentStatus: order.paymentStatus || "Pending",
      items: (order.items || []).map(i => ({ size: i.s, quantity: i.q })),
      total: order.total,
      trackingNumber: order.trackingNumber || "",
      courier: order.courier || "",
      trackingUrl: order.trackingUrl || "",
      adminNote: order.adminNote || ""
    });
  } catch (e) {
    return s.status(500).json({ error: "Unable to retrieve tracking details." });
  }
});

// RAZORPAY PAYMENT VERIFICATION
app.post("/api/payment/verify", rl({ windowMs: 60000, max: 20 }), async (q, s) => {
  try {
    const oid = str(q.body.razorpay_order_id, 60);
    const pid = str(q.body.razorpay_payment_id, 60);
    const sig = str(q.body.razorpay_signature, 128);

    const exp = crypto.createHmac(
      "sha256",
      process.env.RAZORPAY_KEY_SECRET || ""
    ).update(oid + "|" + pid).digest("hex");

    const a = Buffer.from(sig);
    const b = Buffer.from(exp);

    if (!oid || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return s.status(400).json({ ok: false });
    }

    const o = await Order.findOneAndUpdate(
      { rzpOrderId: oid },
      {
        paymentStatus: "Paid",
        rzpPaymentId: pid,
        status: "New"
      }
    );

    s.json({ ok: !!o });

  } catch (e) {
    console.error(e);
    s.status(500).json({ ok: false });
  }
});

// PUBLIC GALLERY
app.get("/api/gallery", async (q, s) => {
  s.json(await Gallery.find().sort("-createdAt").limit(12));
});

// ADMIN LOGIN - ONLY ONE ROUTE
app.post("/api/admin/login", rl({ windowMs: 900000, max: 10 }), (q, s) => {
  const a = Buffer.from(str(q.body.password, 200));
  const b = Buffer.from(process.env.ADMIN_PASSWORD || "");

  if (
    a.length === b.length &&
    b.length > 0 &&
    crypto.timingSafeEqual(a, b)
  ) {
    const t = crypto.randomBytes(24).toString("hex");
    tokens.add(t);
    return s.json({ token: t });
  }

  s.status(401).json({ error: "Wrong password" });
});

// ADMIN ORDERS
app.get("/api/admin/orders", auth, async (q, s) => {
  s.json(await Order.find().sort("-createdAt").limit(200));
});

app.patch("/api/admin/orders/:id", auth, async (q, s) => {
  const allowed = ["New", "Confirmed", "Packed", "Shipped", "Out for delivery", "Delivered", "Cancelled"];
  const status = str(q.body.status, 30);
  if (!allowed.includes(status)) return s.status(400).json({ error: "Invalid order status." });
  const trackingUrl = str(q.body.trackingUrl, 500);
  if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) {
    return s.status(400).json({ error: "Tracking URL must start with https://." });
  }
  const order = await Order.findByIdAndUpdate(q.params.id, {
    status,
    trackingNumber: str(q.body.trackingNumber, 100),
    courier: str(q.body.courier, 100),
    trackingUrl,
    adminNote: str(q.body.adminNote, 500)
  }, { new: true });
  if (!order) return s.status(404).json({ error: "Order not found." });
  s.json(order);
});

// ADMIN GALLERY
app.post("/api/admin/gallery", auth, async (q, s) => {
  const u = str(q.body.imageUrl, 500);

  if (!/^https:\/\//.test(u)) {
    return s.status(400).json({
      error: "Image URL must start with https://"
    });
  }

  s.json(await Gallery.create({
    imageUrl: u,
    caption: str(q.body.caption, 120),
    link: str(q.body.link, 300)
  }));
});

app.delete("/api/admin/gallery/:id", auth, async (q, s) => {
  await Gallery.findByIdAndDelete(q.params.id);
  s.json({ ok: true });
});

// SERVE WEBSITE FILES
app.use(express.static(path.join(__dirname, "public")));

// START SERVER
app.listen(process.env.PORT || 3000, () => {
  console.log("Running on port " + (process.env.PORT || 3000));
});
