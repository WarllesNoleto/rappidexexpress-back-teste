import axios from 'axios';

export async function sendNotificationsFor(
  ids: string[] = [],
  message: string,
) {
  const privateKey = process.env.ONESIGNAL_PRIVATEKEY;
  const appId = process.env.ONESIGNAL_APP_ID_CLIENT;

  const cleanedIds = ids.filter(Boolean);

  if (!privateKey || !appId || !cleanedIds.length) {
    console.log('[OneSignal] envio cancelado:', {
      hasPrivateKey: !!privateKey,
      hasAppId: !!appId,
      totalIds: cleanedIds.length,
    });
    return;
  }

  try {
    const response = await axios.post(
      'https://api.onesignal.com/notifications?c=push',
      {
        app_id: appId,
        target_channel: 'push',
        include_subscription_ids: cleanedIds,
        headings: {
          en: 'Rappidex Express',
          pt: 'Rappidex Express',
        },
        contents: {
          en: message,
          pt: message,
        },
      },
      {
        headers: {
          Authorization: `Key ${privateKey.replace(/^Key\s+/i, '')}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    );

    console.log('[OneSignal] resposta do envio:', response.data);
  } catch (error: any) {
    console.log(
      '[OneSignal] Falha ao enviar notificação:',
      error?.response?.data ?? error?.message ?? error,
    );
  }
}
