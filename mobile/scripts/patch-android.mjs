// Adjusts the generated Android project: allow http:// (servers on the home network) and,
// when the repository has the secrets ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD,
// sign with that fixed key so a new APK installs over the old one.
import fs from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(manifest, 'utf8');
if (!m.includes('usesCleartextTraffic')) m = m.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
// Camera, to scan the invite QR code.
if (!m.includes('android.permission.CAMERA')) m = m.replace('<application', '<uses-permission android:name="android.permission.CAMERA" />\n    <application');
// Invite links open the app: minhascameras://convite/CODE
if (!m.includes('android:scheme="minhascameras"')) {
  m = m.replace(/(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>)/, `$1
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="minhascameras" android:host="convite" />
            </intent-filter>`);
}
fs.writeFileSync(manifest, m);

const b64 = process.env.ANDROID_KEYSTORE_BASE64;
const pass = process.env.ANDROID_KEYSTORE_PASSWORD;
if (b64 && pass) {
  fs.writeFileSync('android/app/release.keystore', Buffer.from(b64, 'base64'));
  const gradle = 'android/app/build.gradle';
  let g = fs.readFileSync(gradle, 'utf8');
  g = g.replace(/android\s*\{/, `android {
    signingConfigs {
        app {
            storeFile file('release.keystore')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS') ?: 'minhascameras'
            keyPassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
        }
    }`);
  g = g.replace(/buildTypes\s*\{/, `buildTypes {
        debug {
            signingConfig signingConfigs.app
        }`);
  fs.writeFileSync(gradle, g);
  console.log('Assinando com a chave fixa (secrets do repositório).');
} else {
  console.log('Sem chave fixa: APK assinado com chave temporária (para atualizar, desinstale a versão anterior).');
}
