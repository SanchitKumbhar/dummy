const crypto = require('crypto');
const axios = require('axios');
const Payment = require('../model/payment.model');
const License = require('../model/license.model');
const Device = require('../model/device.model');

const PLANS = Object.freeze({
    monthly: { amount: 39900, days: 30 },
    annual: { amount: 399900, days: 365 }
});

function getRazorpay() {
    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials are not configured');
    }
    return {
        orders: {
            create: (order) => axios.post('https://api.razorpay.com/v1/orders', order, {
                auth: { username: keyId, password: keySecret },
                timeout: 10000
            }).then((response) => response.data)
        }
    };
}

function validatePaymentInput(body) {
    const { machineId, planType, customerEmail } = body || {};
    if (!machineId || !customerEmail || !PLANS[planType]) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return null;
    return { machineId: String(machineId).trim(), planType, customerEmail: customerEmail.trim().toLowerCase() };
}

const createOrder = async (req, res) => {
    const input = validatePaymentInput(req.body);
    if (!input) return res.status(400).json({ success: false, message: 'machineId, customerEmail and a valid planType are required' });

    try {
        const { amount } = PLANS[input.planType];
        const receipt = `yq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const order = await getRazorpay().orders.create({
            amount,
            currency: 'INR',
            receipt,
            notes: { machineId: input.machineId, planType: input.planType }
        });

        if (!order?.id) throw new Error('Razorpay returned no order ID');
        if (order.currency && order.currency !== 'INR') throw new Error(`Razorpay returned unsupported currency: ${order.currency}`);
        await Payment.create({ orderId: order.id, ...input, amount, currency: 'INR', status: 'created' });
        return res.status(201).json({ orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID.trim(), amount, currency: 'INR' });
    } catch (error) {
        const razorpayError = error.response?.data?.error;
        const details = razorpayError?.description || error.message || 'Unknown payment error';
        console.error('createOrder error:', {
            message: details,
            status: error.response?.status,
            code: razorpayError?.code,
            field: razorpayError?.field,
            reason: razorpayError?.reason,
            mongoCode: error.code
        });
        const message = process.env.NODE_ENV === 'production' ? 'Unable to create payment order' : details;
        return res.status(500).json({ success: false, message });
    }
};

function isValidWebhookSignature(rawBody, signature) {
    if (!signature || !process.env.RAZORPAY_WEBHOOK_SECRET) return false;
    const digest = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const received = Buffer.from(signature);
    const expected = Buffer.from(digest);
    return received.length === expected.length && crypto.timingSafeEqual(expected, received);
}

function createLicenseKey() {
    const value = crypto.randomBytes(9).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12).padEnd(12, 'X');
    return `YQ-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}

async function fulfillCapturedPayment(payload) {
    const entity = payload.payload?.payment?.entity;
    if (!entity?.order_id || !entity.id) throw new Error('Invalid captured payment payload');

    const existingPayment = await Payment.findOne({ orderId: entity.order_id });
    if (!existingPayment) throw new Error(`No local payment record for Razorpay order ${entity.order_id}`);
    if (entity.currency !== 'INR' || Number(entity.amount) !== existingPayment.amount || existingPayment.currency !== 'INR') {
        throw new Error(`Payment amount mismatch for ${entity.order_id}: expected ${existingPayment.amount} ${existingPayment.currency}, received ${entity.amount} ${entity.currency}`);
    }

    const payment = await Payment.findOneAndUpdate(
        { orderId: entity.order_id, status: { $ne: 'captured' } },
        { $set: { paymentId: entity.id, status: 'captured', rawWebhookPayload: payload } },
        { new: true }
    );
    if (!payment) return;

    const { days } = PLANS[payment.planType];
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    let license;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            license = await License.create({
                licenseKey: createLicenseKey(), customerEmail: payment.customerEmail,
                planType: payment.planType, paymentId: payment._id.toString(),
                expiresAt, activatedDevices: [{ machineId: payment.machineId }]
            });
            break;
        } catch (error) {
            if (error.code !== 11000 || attempt === 2) throw error;
        }
    }
    return license;
}

const webhook = async (req, res) => {
    console.log('[Razorpay webhook] request received', {
        method: req.method,
        contentType: req.get('content-type'),
        hasSignature: Boolean(req.get('x-razorpay-signature')),
        bodyBytes: Buffer.isBuffer(req.body) ? req.body.length : 0
    });
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!isValidWebhookSignature(rawBody, req.get('x-razorpay-signature'))) {
        console.warn('[Razorpay webhook] invalid signature or empty raw body');
        return res.status(400).send('Invalid signature');
    }

    try {
        const payload = JSON.parse(rawBody.toString('utf8'));
        console.log('[Razorpay webhook] event:', payload.event || 'unknown');
        if (payload.event === 'payment.captured') await fulfillCapturedPayment(payload);
        if (payload.event === 'payment.failed') {
            const entity = payload.payload?.payment?.entity;
            if (entity?.order_id) await Payment.findOneAndUpdate({ orderId: entity.order_id }, { $set: { paymentId: entity.id, status: 'failed', rawWebhookPayload: payload } });
        }
        return res.sendStatus(200);
    } catch (error) {
        console.error('Razorpay webhook error:', error);
        return res.sendStatus(500);
    }
};

const verifyCheckoutPayment = async (req, res) => {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!orderId || !paymentId || !signature) return res.status(400).json({ success: false, message: 'Payment verification fields are required' });
    const expected = crypto.createHmac('sha256', (process.env.RAZORPAY_KEY_SECRET || '').trim()).update(`${orderId}|${paymentId}`).digest('hex');
    if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return res.status(400).json({ success: false, message: 'Invalid payment signature' });

    try {
        const paymentResponse = await axios.get(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
            auth: { username: process.env.RAZORPAY_KEY_ID.trim(), password: process.env.RAZORPAY_KEY_SECRET.trim() }, timeout: 10000
        });
        const paymentEntity = paymentResponse.data;
        if (paymentEntity.order_id !== orderId || paymentEntity.currency !== 'INR' || !['authorized', 'captured'].includes(paymentEntity.status)) return res.status(400).json({ success: false, message: 'Payment is not a valid INR payment yet' });
        await fulfillCapturedPayment({ event: 'payment.captured', payload: { payment: { entity: paymentEntity } } });
        return res.json({ success: true, status: 'captured' });
    } catch (error) {
        console.error('verifyCheckoutPayment error:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Payment verification failed' });
    }
};

const licenseStatus = async (req, res) => {
    const machineId = String(req.body?.machineId || '').trim();
    if (!machineId) return res.status(400).json({ success: false, message: 'machineId is required' });

    try {
        const now = new Date();
        const license = await License.findOne({ 'activatedDevices.machineId': machineId, status: 'active', expiresAt: { $gt: now } }).sort({ expiresAt: -1 });
        if (license) {
            await License.updateOne({ _id: license._id, 'activatedDevices.machineId': machineId }, { $set: { 'activatedDevices.$.lastValidatedAt': now } });
            return res.json({ status: 'licensed', plan: license.planType, remainingHours: Math.max(0, Math.ceil((license.expiresAt - now) / 3600000)) });
        }

        const device = await Device.findOneAndUpdate(
            { machineId },
            { $set: { lastPingAt: now }, $setOnInsert: { trialStartedAt: now, trialExpiresAt: new Date(now.getTime() + 3 * 24 * 3600000) } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const trialActive = !device.isRevoked && device.trialExpiresAt > now;
        return res.json({ status: trialActive ? 'trial_active' : 'trial_expired', plan: null, remainingHours: trialActive ? Math.ceil((device.trialExpiresAt - now) / 3600000) : 0 });
    } catch (error) {
        console.error('licenseStatus error:', error);
        return res.status(500).json({ success: false, message: 'Unable to check license status' });
    }
};

const checkoutPage = async (req, res) => {
    const orderId = String(req.params.orderId || '');
    const payment = await Payment.findOne({ orderId }).lean();
    if (!payment) return res.status(404).send('Payment order not found');
        const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
        const safeEmail = JSON.stringify(payment.customerEmail).replace(/</g, '\\u003c');
        res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YellowQueue Checkout</title>
<script src="https://checkout.razorpay.com/v1/checkout.js" onload="window.checkoutLoaded=true" onerror="window.checkoutLoadError=true"></script>
<style>body{font-family:system-ui;background:#090d1a;color:#f8fafc;display:grid;place-items:center;height:100vh;margin:0}.box{text-align:center;padding:32px}.button{background:#eab308;color:#090d1a;border:0;border-radius:6px;padding:12px 22px;font-weight:700;cursor:pointer}.button:disabled{opacity:.55;cursor:not-allowed}#message{min-height:20px;color:#fca5a5}</style>
</head><body><main class="box"><h1>YellowQueue</h1><p>Secure payment for your ${payment.planType} plan</p>
<button class="button" id="pay" disabled>Loading secure checkout...</button><p id="message"></p></main>
<script>
const options={key:${JSON.stringify(keyId)},amount:${payment.amount},currency:"INR",name:"YellowQueue",description:${JSON.stringify(`${payment.planType} plan`)},order_id:${JSON.stringify(payment.orderId)},prefill:{email:${safeEmail}},theme:{color:"#eab308"},handler:async function(response){message.textContent="Verifying payment...";try{const result=await fetch("/api/v1/payment/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(response)});const data=await result.json();if(!result.ok)throw new Error(data.message||"Verification failed");message.textContent="Payment verified successfully. You can return to YellowQueue.";}catch(error){message.textContent=error.message||"Payment verification failed.";console.error("Payment verification failed:",error);}}};
const pay=document.getElementById("pay"); const message=document.getElementById("message");
function enableCheckout(){pay.disabled=false;pay.textContent="Pay securely";}
function showCheckoutError(text){message.textContent=text;pay.disabled=false;pay.textContent="Try again";console.error(text);}
function openCheckout(){
    try { if(typeof Razorpay!=="function") return showCheckoutError("Razorpay Checkout did not load. Disable ad blockers or check your internet connection.");
        const checkout=new Razorpay(options);
        checkout.on("payment.failed",function(response){showCheckoutError(response.error?.description||"Payment failed. Please try again.");});
        checkout.open();
    } catch(error) { showCheckoutError(error.message||"Unable to open Razorpay Checkout."); }
}
pay.onclick=openCheckout;
window.addEventListener("load",function(){setTimeout(function(){typeof Razorpay==="function"?enableCheckout():showCheckoutError("Razorpay Checkout did not load. Open this page with internet access.");},300);});
</script></body></html>`);
};

module.exports = { createOrder, webhook, verifyCheckoutPayment, licenseStatus, checkoutPage };