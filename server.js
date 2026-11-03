require("node:dns").setServers(["1.1.1.1", "8.8.8.8"]);
require('dotenv').config();
const express=require('express'),mongoose=require('mongoose'),helmet=require('helmet'),rl=require('express-rate-limit'),crypto=require('crypto'),path=require('path');
const app=express();
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'100kb'}));
mongoose.connect(process.env.MONGODB_URI).then(()=>console.log('MongoDB connected')).catch(e=>{console.error(e.message);process.exit(1)});
const Order=mongoose.model('Order',new mongoose.Schema({name:String,phone:String,address:String,payment:String,items:[{s:Number,q:Number}],total:Number,status:{type:String,default:'New'},paymentStatus:String,rzpOrderId:String,rzpPaymentId:String},{timestamps:true}));
const Gallery=mongoose.model('Gallery',new mongoose.Schema({imageUrl:String,caption:String,link:String},{timestamps:true}));
const PRICE={200:499,500:999},tokens=new Set();
const auth=(q,s,n)=>tokens.has((q.headers.authorization||'').replace('Bearer ',''))?n():s.status(401).json({error:'Unauthorized'});
const str=(v,m)=>String(v||'').trim().slice(0,m);
app.post('/api/orders',rl({windowMs:6e4,max:10}),async(q,s)=>{
 try{const items=(Array.isArray(q.body.items)?q.body.items:[]).filter(i=>PRICE[i.s]&&i.q>0&&i.q<100).map(i=>({s:+i.s,q:Math.floor(+i.q)}));
 const name=str(q.body.name,80),phone=str(q.body.phone,20),address=str(q.body.address,300);
 if(!items.length||!name||!phone||!address)return s.status(400).json({error:'Invalid order'});
 const total=items.reduce((a,i)=>a+PRICE[i.s]*i.q,0); // price computed on server
 const online=/razorpay/i.test(str(q.body.payment,60));
 if(!online){const o=await Order.create({name,phone,address,payment:'Cash on Delivery',items,total});return s.json({ok:true,id:o._id})}
 const {RAZORPAY_KEY_ID:k,RAZORPAY_KEY_SECRET:sec}=process.env;if(!k||!sec)return s.status(503).json({error:'Online payment not configured'});
 const r=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(k+':'+sec).toString('base64')},body:JSON.stringify({amount:total*100,currency:'INR',receipt:'shahee_'+Date.now()})});
 const rz=await r.json();if(!r.ok)return s.status(502).json({error:'Payment provider error'});
 const o=await Order.create({name,phone,address,payment:'Online (Razorpay)',items,total,status:'Pending payment',paymentStatus:'Created',rzpOrderId:rz.id});
 s.json({ok:true,id:o._id,rzp:{orderId:rz.id,amount:rz.amount,key:k}})}
 catch(e){s.status(500).json({error:'Server error'})}});
app.post('/api/payment/verify',rl({windowMs:6e4,max:20}),async(q,s)=>{
 try{const oid=str(q.body.razorpay_order_id,60),pid=str(q.body.razorpay_payment_id,60),sig=str(q.body.razorpay_signature,128);
 const exp=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(oid+'|'+pid).digest('hex');
 const a=Buffer.from(sig),b=Buffer.from(exp);
 if(!oid||a.length!==b.length||!crypto.timingSafeEqual(a,b))return s.status(400).json({ok:false});
 const o=await Order.findOneAndUpdate({rzpOrderId:oid},{paymentStatus:'Paid',rzpPaymentId:pid,status:'New'});
 s.json({ok:!!o})}catch(e){s.status(500).json({ok:false})}});
app.get('/api/gallery',async(q,s)=>s.json(await Gallery.find().sort('-createdAt').limit(12)));
app.post('/api/admin/login',rl({windowMs:9e5,max:10}),(q,s)=>{
app.post('/api/admin/login', (q, s) => {
  const a = Buffer.from(str(q.body.password, 200));
  const b = Buffer.from(process.env.ADMIN_PASSWORD || '');

  if (a.length === b.length && b.length &&
      crypto.timingSafeEqual(a, b)) {
    const t = crypto.randomBytes(24).toString('hex');
    tokens.add(t);
    return s.json({ token: t });
  }

  s.status(401).json({ error: 'Wrong password' });
});
app.get('/api/admin/orders',auth,async(q,s)=>s.json(await Order.find().sort('-createdAt').limit(200)));
app.patch('/api/admin/orders/:id',auth,async(q,s)=>s.json(await Order.findByIdAndUpdate(q.params.id,{status:str(q.body.status,20)},{new:true})));
app.post('/api/admin/gallery',auth,async(q,s)=>{const u=str(q.body.imageUrl,500);if(!/^https:\/\//.test(u))return s.status(400).json({error:'Image URL must start with https://'});s.json(await Gallery.create({imageUrl:u,caption:str(q.body.caption,120),link:str(q.body.link,300)}))});
app.delete('/api/admin/gallery/:id',auth,async(q,s)=>{await Gallery.findByIdAndDelete(q.params.id);s.json({ok:true})});
app.use(express.static(path.join(__dirname,'public')));
app.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)));
