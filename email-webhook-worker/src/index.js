import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    let stage = 'initialization';

    try {
      const webhookSecret = env.EMAIL_WEBHOOK_SECRET;

      if (!webhookSecret) {
        throw new Error('EMAIL_WEBHOOK_SECRET is not configured in the Worker environment');
      }

      stage = 'email parsing';
      const parser = new PostalMime();
      const parsedEmail = await parser.parse(message.raw);

      stage = 'form construction';
      const formData = new FormData();
      formData.append('from', message.from);
      formData.append('to', message.to);
      formData.append('subject', parsedEmail.subject || "No Subject");
      formData.append('text', parsedEmail.text || "");

      if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
        parsedEmail.attachments.forEach((att, index) => {
          const blob = new Blob([att.content], { type: att.mimeType });
          formData.append('attachments', blob, att.filename || `attachment_${index}`);
        });
      }

      stage = 'webhook delivery';
      const backendWebhookUrl = "https://api.yellowqueue.dev/api/email/inbound-parse"; 
      
      const response = await fetch(backendWebhookUrl, {
        method: 'POST',
        headers: {
          'x-webhook-secret': webhookSecret
        },
        body: formData
      });

      if (!response.ok) {
        const responseBody = await response.text();
        console.error("Backend rejected the webhook:", response.status, responseBody);
        message.setReject("Webhook delivery failed");
      }
    } catch (error) {
      console.error(`Worker error during ${stage}:`, error?.stack || error);
      message.setReject(`Email processing failed during ${stage}`);
    }
  }
};

