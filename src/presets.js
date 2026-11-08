// Ready-made settings per camera brand, so adding a camera is just IP + password.
export const BRANDS = {
  yoosee: {
    setup: 'No app Yoosee: toque em + → Adicionar novo dispositivo e siga os passos (QR code ou som) para ligar a câmera ao seu Wi-Fi. Depois, em Configurações → Segurança, defina a senha do dispositivo. Não precisa assinar a nuvem.',
    label: 'Yoosee / Jortan / câmeras do app Yoosee',
    user: 'admin', rtspPort: 554, mainPath: '/onvif1', subPath: '/onvif2', onvifPort: 5000, ptz: true,
    hint: 'Use a "senha do dispositivo" definida no app Yoosee. Usuário: admin.',
  },
  intelbras: {
    setup: 'Use o app da marca (Mibo, Imou ou DMSS) para ligar a câmera ao Wi-Fi; a senha é criada nessa configuração (no Imou, é o código de segurança da etiqueta).',
    label: 'Intelbras / Dahua / Imou',
    user: 'admin', rtspPort: 554,
    mainPath: '/cam/realmonitor?channel=1&subtype=0', subPath: '/cam/realmonitor?channel=1&subtype=1',
    onvifPort: 80, ptz: false,
    hint: 'Senha do dispositivo (no Imou, é o "código de segurança" da etiqueta).',
  },
  hikvision: {
    setup: 'Use o app Hik-Connect para ativar a câmera, ligar ao Wi-Fi e criar a senha.',
    label: 'Hikvision',
    user: 'admin', rtspPort: 554, mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102',
    onvifPort: 80, ptz: false, hint: '',
  },
  ezviz: {
    setup: 'Use o app EZVIZ para ligar a câmera ao Wi-Fi. A senha é o código de verificação da etiqueta.',
    label: 'Ezviz',
    user: 'admin', rtspPort: 554, mainPath: '/h264/ch1/main/av_stream', subPath: '/h264/ch1/sub/av_stream',
    onvifPort: 80, ptz: false,
    hint: 'A senha é o "código de verificação" (6 letras) da etiqueta da câmera.',
  },
  tapo: {
    setup: 'Use o app Tapo para ligar a câmera ao Wi-Fi. Depois crie a Conta da câmera em Configurações → Avançado.',
    label: 'TP-Link Tapo',
    user: '', rtspPort: 554, mainPath: '/stream1', subPath: '/stream2', onvifPort: 2020, ptz: true,
    hint: 'No app Tapo: câmera → Configurações → Avançado → Conta da câmera. Use esse usuário e senha.',
  },
  reolink: {
    setup: 'Use o app Reolink para ligar a câmera ao Wi-Fi e criar a senha. Ative RTSP e ONVIF.',
    label: 'Reolink',
    user: 'admin', rtspPort: 554, mainPath: '/h264Preview_01_main', subPath: '/h264Preview_01_sub',
    onvifPort: 8000, ptz: false, hint: 'Ative RTSP e ONVIF no app Reolink (Configurações de rede → Avançado).',
  },
  generic: {
    setup: 'Use o app que veio com a câmera (veja a caixa ou o manual) para ligá-la ao Wi-Fi e criar a senha.',
    label: 'Outra marca (digitar endereço RTSP)',
    custom: true, user: '', rtspPort: 554, mainPath: '', subPath: '', onvifPort: 80, ptz: false,
    hint: 'Cole o endereço RTSP completo, como no VLC: rtsp://usuario:senha@IP:554/caminho',
  },
};

/** Guess the brand from what the network scan saw. */
export function guessBrand({ onvifPort }) {
  if (onvifPort === 5000) return 'yoosee';
  if (onvifPort === 2020) return 'tapo';
  if (onvifPort === 8000) return 'reolink';
  return 'generic';
}

// Only escape characters that break the URL (passwords like "$abc" are sent as typed).
const esc = (v) => String(v).replace(/[@:/?#%\s]/g, (ch) => encodeURIComponent(ch));

/** Builds the runtime camera (RTSP URLs etc.) from what is saved. */
export function resolveCamera(c) {
  const preset = BRANDS[c.brand] || BRANDS.generic;
  const cam = {
    id: c.id,
    name: c.name || c.id,
    brand: BRANDS[c.brand] ? c.brand : 'generic',
    host: c.host || '',
    user: c.user ?? preset.user,
    password: c.password || '',
    rtspPort: Number(c.rtspPort) || preset.rtspPort,
    onvifPort: Number(c.onvifPort) || preset.onvifPort,
    ptz: c.ptz ?? preset.ptz,
    transport: c.transport || 'auto',
    alerts: c.alerts !== false,
    inputArgs: c.inputArgs || [],
  };
  if (preset.custom) {
    cam.main = c.main || '';
    cam.sub = c.sub || cam.main;
    try {
      cam.host ||= new URL(cam.main).hostname;
    } catch { /* invalid URL: the test will tell */ }
  } else {
    const auth = cam.password || cam.user ? `${esc(cam.user)}:${esc(cam.password)}@` : '';
    const base = `rtsp://${auth}${cam.host}:${cam.rtspPort}`;
    cam.main = c.main || base + (c.mainPath || preset.mainPath);
    cam.sub = c.sub || base + (c.subPath || preset.subPath);
  }
  if (!cam.host) cam.ptz = false;
  return cam;
}
