import axios from 'axios';

type SendPushNotificationParams = {
  subscriptionIds: string[];
  title: string;
  message: string;
};

export async function sendPushNotification({
  subscriptionIds,
  title,
  message,
}: SendPushNotificationParams): Promise<void> {
  const validSubscriptionIds = subscriptionIds.filter(Boolean);

  if (!validSubscriptionIds.length) {
    console.log('Nenhum subscriptionId válido para envio.');
    return;
  }

  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    throw new Error('OneSignal não configurado no .env do backend.');
  }

  await axios.post(
    'https://api.onesignal.com/notifications?c=push',
    {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_subscription_ids: validSubscriptionIds,
      headings: {
        en: title,
      },
      contents: {
        en: message,
      },
    },
    {
      headers: {
        Authorization: `Key ${process.env.ONESIGNAL_REST_API_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  );
}