import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Push notifications to the Android app through Firebase Cloud Messaging (free).
 * Needs the Firebase "service account" file, uploaded once in Ajustes → Alertas.
 */
export class Push {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'firebase.json');
    this.token = null;
    this.tokenExp = 0;
    this.lastError = '';
  }

  get account() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  get configured() {
    return !!this.account;
  }

  info() {
    const a = this.account;
    return { configured: !!a, project: a?.project_id || '', error: this.lastError };
  }

  setAccount(text) {
    let a;
    try {
      a = JSON.parse(text);
    } catch {
      throw Object.assign(new Error('Arquivo inválido: use o .json baixado em Firebase → Contas de serviço.'), { status: 400 });
    }
    if (a.type !== 'service_account' || !a.private_key || !a.client_email || !a.project_id) {
      throw Object.assign(new Error('Esse não é o arquivo da conta de serviço do Firebase.'), { status: 400 });
    }
    fs.writeFileSync(this.file, JSON.stringify(a));
    this.token = null;
    this.lastError = '';
  }

  clear() {
    fs.rmSync(this.file, { force: true });
    this.token = null;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    const a = this.account;
    if (!a) throw new Error('Firebase não configurado');
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: a.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: a.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), a.private_key).toString('base64url');
    const res = await fetch(a.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`Firebase recusou a conta de serviço: ${j.error_description || j.error || res.status}`);
    this.token = j.access_token;
    this.tokenExp = Date.now() + ((j.expires_in || 3600) - 300) * 1000;
    return this.token;
  }

  /**
   * Sends to each device token. Returns tokens that no longer exist (app uninstalled),
   * so they can be forgotten.
   */
  async send(tokens, { title, body, image, data }) {
    if (!this.configured || !tokens.length) return [];
    const a = this.account;
    const gone = [];
    this.lastError = '';
    try {
      const auth = await this.accessToken();
      await Promise.all(
        tokens.map(async (token) => {
          const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body, ...(image ? { image } : {}) },
                data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
                android: { priority: 'HIGH', notification: { sound: 'default', channel_id: 'alertas' } },
              },
            }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            const code = j.error?.details?.find((d) => d.errorCode)?.errorCode || j.error?.status;
            if (code === 'UNREGISTERED' || res.status === 404) gone.push(token);
            else this.lastError = `Falha ao enviar notificação: ${j.error?.message || res.status}`;
          }
        }),
      );
    } catch (e) {
      this.lastError = e.message;
    }
    return gone;
  }
}
