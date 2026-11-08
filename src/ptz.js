import onvif from 'onvif';

const DIRS = {
  up: { x: 0, y: 0.5 },
  down: { x: 0, y: -0.5 },
  left: { x: -0.5, y: 0 },
  right: { x: 0.5, y: 0 },
};

/** Pans/tilts cameras with a motor through ONVIF. */
export class Ptz {
  constructor(getCam) {
    this.getCam = getCam;
    this.conns = new Map();
  }

  forget(id) {
    this.conns.delete(id);
  }

  _connect(cam) {
    if (this.conns.has(cam.id)) return this.conns.get(cam.id);
    const p = new Promise((resolve, reject) => {
      const conn = new onvif.Cam(
        { hostname: cam.host, port: cam.onvifPort, username: cam.user, password: cam.password, timeout: 8000 },
        (err) => (err ? reject(new Error(`Não consegui falar com o motor da câmera (ONVIF porta ${cam.onvifPort}): ${err.message}`)) : resolve(conn)),
      );
    });
    p.catch(() => this.conns.delete(cam.id));
    this.conns.set(cam.id, p);
    return p;
  }

  async move(camId, dir, ms = 600) {
    const cam = this.getCam(camId);
    if (!cam || !cam.ptz) throw Object.assign(new Error('Esta câmera não tem controle de giro'), { status: 404 });
    const v = DIRS[dir];
    if (!v) throw Object.assign(new Error('Direção inválida'), { status: 400 });
    const conn = await this._connect(cam);
    await new Promise((resolve, reject) =>
      conn.continuousMove({ ...v, zoom: 0 }, (err) => (err ? reject(err) : resolve())),
    );
    await new Promise((r) => setTimeout(r, Math.min(Math.max(ms, 100), 3000)));
    await new Promise((resolve) => conn.stop({ panTilt: true, zoom: true }, () => resolve()));
  }
}
