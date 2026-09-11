const express = require('express');
const { createOrder, webhook, verifyCheckoutPayment, licenseStatus, checkoutPage } = require('../controller/payment.controller');

const router = express.Router();
const licenseRouter = express.Router();
router.post('/create-order', express.json(), createOrder);
router.post('/webhook', express.raw({ type: 'application/json', limit: '256kb' }), webhook);
router.get('/webhook', (_req, res) => res.status(200).json({ status: 'ok', message: 'Webhook endpoint accepts POST requests from Razorpay' }));
router.get('/webhook/health', (_req, res) => res.json({ status: 'ok', endpoint: 'razorpay-webhook' }));
router.get('/checkout/:orderId', checkoutPage);
router.post('/verify', express.json(), verifyCheckoutPayment);
licenseRouter.post('/status', express.json(), licenseStatus);

module.exports = { router, licenseRouter };