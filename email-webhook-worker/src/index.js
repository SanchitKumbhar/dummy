import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    try {
      const parser = new PostalMime();
      
      const rawEmail = new Response(message.raw);
      const parsedEmail = await parser.parse(await rawEmail.arrayBuffer());

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

      // ⚠️ REPLACE WITH YOUR CURRENT NGROK URL
      const backendWebhookUrl = "https://c9ad-2401-4900-36cb-dfce-6432-626c-d428-56ab.ngrok-free.app/api/email/inbound-parse"; 
      
      const response = await fetch(backendWebhookUrl, {
        method: 'POST',
        headers: {
          'x-webhook-secret': 'my_super_secret_key_123'
        },
        body: formData
      });

      if (!response.ok) {
        console.error("Backend rejected the webhook:", response.status);
        message.setReject("Webhook delivery failed");
      }
    } catch (error) {
      console.error("Worker error parsing email:", error.message);
      message.setReject("Internal parser error");
    }
  }
};