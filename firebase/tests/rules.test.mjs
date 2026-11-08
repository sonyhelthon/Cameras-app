import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setLogLevel, doc, setDoc, getDoc, updateDoc, writeBatch, Timestamp, deleteField, collection, addDoc, getDocs } from 'firebase/firestore';

setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-cameras', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 } });
const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = env.unauthenticatedContext().firestore();
let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FALHOU', name, '-', e.message.split('\n')[0]); } }
const inH = (h) => Timestamp.fromMillis(Date.now() + h * 3600_000);

const sony = db('sony'), pai = db('pai'), estranho = db('estranho'), pc = db('pc-casa'), pc2 = db('pc-intruso');

console.log('Locais');
await t('Sony cria a Casa (dono e admin)', assertSucceeds(setDoc(doc(sony, 'sites/casa'), { name: 'Casa', owner: 'sony', members: { sony: 'admin' }, memberInfo: { sony: { name: 'Sony' } }, devices: {} })));
await t('não dá para criar local já com outros membros', assertFails(setDoc(doc(sony, 'sites/x'), { name: 'X', owner: 'sony', members: { sony: 'admin', pai: 'admin' }, devices: {} })));
await t('não dá para criar local em nome de outro dono', assertFails(setDoc(doc(estranho, 'sites/y'), { name: 'Y', owner: 'sony', members: { estranho: 'admin' }, devices: {} })));
await t('estranho não vê a Casa', assertFails(getDoc(doc(estranho, 'sites/casa'))));
await t('sem login não vê nada', assertFails(getDoc(doc(anon, 'sites/casa'))));
await t('estranho não consegue se colocar na Casa sem convite', assertFails(updateDoc(doc(estranho, 'sites/casa'), { 'members.estranho': 'admin' })));

console.log('Convite por link');
await t('pai não pode criar convite (não é admin)', assertFails(setDoc(doc(pai, 'invites/AAA'), { siteId: 'casa', siteName: 'Casa', role: 'viewer', by: 'pai', usedBy: null, expiresAt: inH(48) })));
await t('Sony cria convite "Só ver" de 48 h', assertSucceeds(setDoc(doc(sony, 'invites/K7P2Q9'), { siteId: 'casa', siteName: 'Casa', role: 'viewer', by: 'sony', byName: 'Sony', usedBy: null, expiresAt: inH(48) })));
await t('convite com validade longa demais é recusado', assertFails(setDoc(doc(sony, 'invites/LONGO'), { siteId: 'casa', siteName: 'Casa', role: 'viewer', by: 'sony', usedBy: null, expiresAt: inH(24 * 30) })));
await t('pai lê o convite (para ver quem convidou)', assertSucceeds(getDoc(doc(pai, 'invites/K7P2Q9'))));
const accept = (who, code, role) => { const d = db(who); const b = writeBatch(d); b.update(doc(d, `invites/${code}`), { usedBy: who, usedAt: Timestamp.now() }); b.update(doc(d, 'sites/casa'), { [`members.${who}`]: role, [`memberInfo.${who}`]: { name: who }, lastInvite: code }); return b.commit(); };
await t('pai NÃO consegue aceitar virando admin (convite é "Só ver")', assertFails(accept('pai', 'K7P2Q9', 'admin')));
await t('pai aceita como "Só ver"', assertSucceeds(accept('pai', 'K7P2Q9', 'viewer')));
await t('pai agora vê a Casa', assertSucceeds(getDoc(doc(pai, 'sites/casa'))));
await t('link repassado: estranho não consegue usar o mesmo convite', assertFails(accept('estranho', 'K7P2Q9', 'viewer')));
await t('pai (Só ver) não consegue se promover a admin', assertFails(updateDoc(doc(pai, 'sites/casa'), { 'members.pai': 'admin' })));
await setDoc(doc(sony, 'invites/VELHO'), { siteId: 'casa', siteName: 'Casa', role: 'viewer', by: 'sony', usedBy: null, expiresAt: Timestamp.fromMillis(Date.now() + 1000) });
await new Promise((r) => setTimeout(r, 1500));
await t('convite vencido não funciona', assertFails(accept('estranho', 'VELHO', 'viewer')));

console.log('Computador do local');
await t('computador novo cria código de pareamento', assertSucceeds(setDoc(doc(pc, 'pairings/123456'), { deviceUid: 'pc-casa', siteId: null, name: 'PC da sala' })));
await t('computador não cria código em nome de outro', assertFails(setDoc(doc(pc2, 'pairings/999999'), { deviceUid: 'pc-casa', siteId: null })));
await t('pai (Só ver) não pode ligar computador à Casa', assertFails(updateDoc(doc(pai, 'pairings/123456'), { siteId: 'casa', siteName: 'Casa', by: 'pai' })));
await t('Sony confirma o código no app', assertSucceeds(updateDoc(doc(sony, 'pairings/123456'), { siteId: 'casa', siteName: 'Casa', by: 'sony' })));
await t('Sony registra o computador na Casa', assertSucceeds(updateDoc(doc(sony, 'sites/casa'), { 'devices.pc-casa': true })));
await t('computador lê a Casa', assertSucceeds(getDoc(doc(pc, 'sites/casa'))));
await t('computador atualiza o próprio status', assertSucceeds(updateDoc(doc(pc, 'sites/casa'), { server: { lan: ['http://192.168.100.47:8080'], lastSeen: Timestamp.now() } })));
await t('computador NÃO mexe nos membros', assertFails(updateDoc(doc(pc, 'sites/casa'), { 'members.pc-casa': 'admin' })));
await t('outro computador não lê a Casa', assertFails(getDoc(doc(pc2, 'sites/casa'))));

console.log('Alertas');
await t('computador grava alerta', assertSucceeds(addDoc(collection(pc, 'sites/casa/events'), { cam: 'garagem', ts: Timestamp.now() })));
await t('computador intruso não grava alerta', assertFails(addDoc(collection(pc2, 'sites/casa/events'), { cam: 'x' })));
await t('pai lê alertas', assertSucceeds(getDocs(collection(pai, 'sites/casa/events'))));
await t('estranho não lê alertas', assertFails(getDocs(collection(estranho, 'sites/casa/events'))));
await t('pai (Só ver) não apaga alerta', assertFails(getDocs(collection(pai, 'sites/casa/events')).then((s) => import('firebase/firestore').then(({ deleteDoc }) => deleteDoc(s.docs[0].ref)))));

console.log('Remover / sair');
await t('Sony não pode ser removido da própria Casa', assertFails(updateDoc(doc(sony, 'sites/casa'), { 'members.sony': deleteField() })));
await t('Sony remove o pai', assertSucceeds(updateDoc(doc(sony, 'sites/casa'), { 'members.pai': deleteField(), 'memberInfo.pai': deleteField() })));
await t('pai removido não vê mais a Casa', assertFails(getDoc(doc(pai, 'sites/casa'))));
console.log(`\n${pass} ok, ${fail} falharam`);
await env.cleanup();
process.exit(fail ? 1 : 0);
