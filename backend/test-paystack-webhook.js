require('dotenv').config();
const crypto = require('crypto');

const payload = {
  event: 'charge.success',
  data: {
    id: 1234567890,
    reference: `SIS-${Date.now()}`,
    amount: 50000,
    currency: 'GHS',
    status: 'success',
    email: 'student1@example.com',
    customer: {
      email: 'student1@example.com',
      id: 999,
    },
    metadata: {
      studentId: 1,
      fullName: 'Kwame Mensah',
    },
  },
};

const ports = Array.from(new Set([process.env.PORT, '5000', '5001', '5002', '5003', '5010'].filter(Boolean)));
const raw = JSON.stringify(payload);
const secret = process.env.PAYSTACK_SECRET_KEY || 'test_secret';
const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex');

async function tryWebhookOnPort(port) {
  try {
    const response = await fetch(`http://localhost:${port}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': signature,
      },
      body: raw,
    });

    const text = await response.text();
    console.log(`status on port ${port}:`, response.status);
    console.log('response:', text);
    return true;
  } catch (error) {
    return false;
  }
}

(async () => {
  for (const port of ports) {
    const reached = await tryWebhookOnPort(port);
    if (reached) {
      return;
    }
  }

  console.warn('Webhook check skipped because the local app is not running on a known development port.');
})();
