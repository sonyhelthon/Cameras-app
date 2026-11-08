import onvif from 'onvif';

const DIRS = {
  up: { x: 0, y: 0.5 },
  down: { x: 0, y: -0.5 },
  left: { x: -0.5, y: 0 },
  right: { x: 0.5, y: 0 },
};

/** Pans/tilts the camera through ONVIF (the motor of the JT-8177). */
export class Ptz {
  constructor(cams) {
    this.cams = new Map(cams.filter((c) => c.ptz).map((c) => [c.id, c]));
    this.conns = new Map();
  }

  _connect(cam) {
    if (this.conns.has(cam.id)) return this.conns.get(cam.id);
    const p = new Promise((resolve, reject) => {
      const conn = new onvif.Cam(
        { hostname: cam.host, port: cam.onvifPort, username: cam.user, password: cam.password, timeout: 8000 },
        (err) => (err ? reject(new Error(`ONVIF: ${err.message}`)) : resolve(conn)),
      );
    });
    p.catch(() => this.conns.delete(cam.id));
    this.conns.set(cam.id, p);
    return p;
  }

  async move(camId, dir, ms = 600) {
    const cam = this.cams.get(camId);
    if (!cam) throw Object.assign(new Error('Esta câmera não tem controle de giro'), { status: 404 });
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
