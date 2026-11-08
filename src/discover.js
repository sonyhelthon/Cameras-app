import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Finds cameras on the local network: ONVIF WS-Discovery (multicast) + a scan of the RTSP
 * port 554 on the local /24 networks.
 */
export async function discover() {
  const [onvif, rtsp] = await Promise.all([onvifProbe(3500), scanRtsp()]);
  const found = new Map();
  for (const h of rtsp) found.set(h, { host: h, rtsp: true, onvifPort: null });
  for (const { host, port } of onvif) {
    const f = found.get(host) || { host, rtsp: false };
    f.onvifPort = port;
    found.set(host, f);
  }
  return [...found.values()].sort((a, b) => ipNum(a.host) - ipNum(b.host));
}

function ipNum(ip) {
  return ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
}

/** Private IPv4 /24 networks of this computer (skips virtual adapters' 172.x by default last). */
function localNets() {
  const nets = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (!/^(192\.168|10)\./.test(i.address) && !/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)) continue;
      nets.push({ prefix: i.address.split('.').slice(0, 3).join('.'), self: i.address, home: /^192\.168|^10\./.test(i.address) });
    }
  }
  // Home networks first; at most 3 networks to keep the scan fast.
  return nets.sort((a, b) => b.home - a.home).slice(0, 3);
}

function probePort(host, port, timeout = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

async function scanRtsp() {
  const hosts = [];
  for (const n of localNets()) for (let i = 1; i < 255; i++) {
    const h = `${n.prefix}.${i}`;
    if (h !== n.self) hosts.push(h);
  }
  const open = [];
  // In batches so we don't open hundreds of sockets at once.
  for (let i = 0; i < hosts.length; i += 128) {
    const batch = hosts.slice(i, i + 128);
    const res = await Promise.all(batch.map((h) => probePort(h, 554)));
    batch.forEach((h, j) => res[j] && open.push(h));
  }
  return open;
}

function onvifProbe(timeout) {
  return new Promise((resolve) => {
    const results = new Map();
    let sock;
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      return resolve([]);
    }
    const msg = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ` +
        `xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">` +
        `<e:Header><w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>` +
        `<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>` +
        `<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`,
    );
    sock.on('message', (buf, rinfo) => {
      const xaddrs = /XAddrs>([^<]+)</.exec(buf.toString())?.[1] || '';
      let port = 80;
      for (const a of xaddrs.split(/\s+/)) {
        try {
          const u = new URL(a);
          if (u.hostname === rinfo.address) port = Number(u.port) || 80;
        } catch { /* ignore */ }
      }
      results.set(rinfo.address, { host: rinfo.address, port });
    });
    sock.on('error', () => {});
    sock.bind(0, () => {
      for (let i = 0; i < 2; i++) sock.send(msg, 3702, '239.255.255.250', () => {});
    });
    setTimeout(() => {
      try {
        sock.close();
      } catch { /* closed */ }
      resolve([...results.values()]);
    }, timeout);
  });
}
