# SHCAM: câmeras sem nuvem paga

App para ver, controlar e gravar câmeras Wi-Fi de **qualquer marca** (com RTSP/ONVIF), sem pagar a nuvem do fabricante.

```
câmeras ──Wi-Fi──▶ computador servidor (grava 24 h) ──▶ Google Drive
                         │
                         └──▶ app no celular / navegador (em casa ou fora, pelo Tailscale)
```

- **Adicionar câmeras pelo app:** procura na rede, escolhe a marca, digita a senha e **testa na hora** (mostra a imagem).
- **Ao vivo:** todas as câmeras na tela; toque numa para tela cheia, HD, som e **setas para girar**.
- **Gravação 24 horas** no computador servidor, com **envio automático para o Google Drive**.
- **Gravações:** escolha a câmera e o dia e assista (do computador ou do Drive).
- **Funciona no Android e no navegador** (instala como app).

Marcas já prontas na lista: **Yoosee/Jortan, Intelbras/Dahua/Imou, Hikvision, Ezviz, TP-Link Tapo, Reolink**. Qualquer outra funciona pela opção "Outra marca" (endereço RTSP).

---

## Instalação no computador servidor (Windows)

Faça uma vez em cada local (casa, igreja…).

1. **Instale o Node.js** (versão LTS) baixando em nodejs.org.
2. **Baixe este app:** em github.com/sonyhelthon/cameras-app clique em **Code → Download ZIP**. Extraia, por exemplo, em `C:\cameras\app`.
3. **Dê dois cliques em `iniciar.bat`.**
   - Na primeira vez, ele instala o que falta e **baixa o ffmpeg sozinho** (programa de vídeo, uns 100 MB). Pode levar alguns minutos.
   - Se o **Firewall do Windows** perguntar, clique em **Permitir** (redes privadas).
4. No navegador **desse computador**, abra **http://localhost:8080**:
   - **Crie a senha** do app.
   - Em **⚙ Ajustes → Google Drive**, clique em **Conectar conta Google**. O login do Google abre nesse navegador. Entre na conta e clique em **Permitir**.
   - Escreva a **pasta no Drive** (ex.: `Cameras/Casa` ou `Cameras/Igreja`), marque **Enviar gravações para o Drive** e clique em **Salvar**.
   - Em **Câmeras → + Adicionar câmera**, adicione cada câmera (veja abaixo).

### O computador não pode dormir
- Configurações → Sistema → Energia: **Tela e suspensão → "Nunca"** (na tomada).
- Painel de Controle → Opções de Energia → "Escolher a função de fechar a tampa": **"Nada a fazer"**.
- Para abrir sozinho quando o Windows ligar: `Win + R` → `shell:startup` → coloque ali um **atalho** do `iniciar.bat`.

---

## Adicionar uma câmera (pelo celular ou computador)

1. **⚙ Ajustes → + Adicionar câmera**
2. Toque em **Procurar câmeras na rede** e escolha o IP encontrado, ou digite o IP.
3. Escolha a **marca/app** da câmera. A dica embaixo diz qual senha usar.
4. Digite a **senha** e toque em **Testar**. Se aparecer a imagem, toque em **Salvar**.

Dicas:
- **Yoosee / Jortan:** usuário `admin`, senha = "senha do dispositivo" do app Yoosee.
- No roteador, **reserve o IP** de cada câmera (DHCP estático), para não mudar.
- Se o teste disser "endereço não existe", tente outra marca na lista ou "Outra marca" com o endereço RTSP do manual.

---

## App Android

1. No celular, abra **github.com/sonyhelthon/cameras-app/releases/tag/app-android** e baixe o **SHCAM.apk**.
2. Toque no arquivo baixado e instale. Se o Android pedir, permita **"instalar apps desconhecidos"** para o navegador.
3. Abra o app e toque em **+ Adicionar local**:
   - **Nome:** Casa, Igreja…
   - **Endereço em casa:** o que aparece em **Ajustes → Este local** no servidor (ex.: `192.168.100.47:8080`).
   - **Endereço de fora (opcional):** o endereço do Tailscale (veja abaixo).
   - Toque em **Testar** e depois em **Salvar**.
4. Toque no local para abrir. O botão **⇄** no topo volta para a lista de locais.

Na tela cheia, o vídeo gira para deitado. Use **pinça** ou **dois toques** para dar zoom, e **📷 Foto** para salvar a imagem.

> **Atualizar o app:** baixe o APK novo pelo mesmo link. Se o Android disser que o app é incompatível, desinstale o antigo antes. Os locais precisam ser cadastrados de novo. Para não precisar desinstalar, cadastre uma chave fixa nos *Secrets* do GitHub (`ANDROID_KEYSTORE_BASE64` e `ANDROID_KEYSTORE_PASSWORD`).

Também funciona sem o APK: no Chrome do celular, abra o endereço do servidor e use **⋮ → Adicionar à tela inicial**.

### Fora de casa (grátis e seguro): Tailscale
Instale o **Tailscale** (tailscale.com) no computador servidor e no celular, com a mesma conta. No app, coloque o endereço `100.x.x.x` do servidor (aparece no app do Tailscale) em **Endereço de fora**. **Não abra portas no roteador.**

## Alertas de pessoas

O computador servidor vigia cada câmera (em qualidade baixa, 2 imagens por segundo). Quando algo se mexe, uma inteligência artificial **que roda no próprio computador** confere se é **uma pessoa**. Vento, chuva, sombras e animais não geram alerta. Quando é uma pessoa:
- a foto, com um quadro vermelho em volta da pessoa, aparece na aba **🔔 Alertas**, e o botão **▶ Ver gravação** abre o vídeo daquele momento;
- os celulares com o app recebem uma **notificação** (depois de configurar o Firebase, abaixo).

Em **Ajustes → Alertas de pessoas** você escolhe a sensibilidade, o tempo entre alertas e os horários (ex.: só das 22:00 às 06:00). Para desligar numa câmera: **Câmeras → Editar → "Avisar quando aparecer pessoa"**.

Na primeira vez, o app baixa o modelo de detecção (3,6 MB). Os alertas ficam guardados por 30 dias.

### Notificações no celular (Firebase, grátis; fazer uma vez)
1. Entre em **console.firebase.google.com** com sua conta Google → **Criar projeto** (nome: "SHCAM"; pode desativar o Google Analytics).
2. No projeto, clique no ícone do **Android** para adicionar um app:
   - **Nome do pacote:** `com.sonyhelthon.minhascameras`
   - Clique em **Registrar app** e **baixe o `google-services.json`**. Pode pular os outros passos.
3. No GitHub: **github.com/sonyhelthon/cameras-app → Settings → Secrets and variables → Actions → New repository secret**
   - **Name:** `GOOGLE_SERVICES_JSON`
   - **Secret:** cole todo o conteúdo do `google-services.json` (abra no Bloco de Notas, Ctrl+A, Ctrl+C).
4. No GitHub: **Actions → App Android → Run workflow**. Em uns 3 minutos sai um APK novo com notificações. Instale no celular (desinstale o antigo antes).
5. No Firebase: **⚙ Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Isso baixa um arquivo `.json`.
6. No app, no computador servidor: **Ajustes → Alertas de pessoas → Arquivo do Firebase**, e escolha esse arquivo. Faça isso em cada local (casa, igreja). **Guarde esse arquivo com cuidado e não compartilhe**: ele permite enviar notificações em nome do seu projeto.
7. Abra o app no celular (ele pede permissão para notificações: toque em **Permitir**) e, no servidor, clique em **Enviar notificação de teste**.

A foto aparece dentro da notificação só quando o servidor tem **endereço de fora** (https). Sem ele, a notificação chega com o texto, e a foto aparece ao tocar nela, dentro do app (no Wi-Fi do local).

## Espaço no Drive

As câmeras Yoosee/Jortan usam H.265, que ocupa pouco espaço: cerca de **5 GB por câmera por dia** em alta qualidade, o que depende do movimento na imagem. Em **Ajustes → Google Drive**, escolha quantos dias manter. O app apaga as gravações mais antigas sozinho e mostra o espaço livre.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Teste diz "não respondeu" | Confira o IP e se a câmera está no mesmo Wi-Fi do computador. |
| Teste diz "usuário ou senha incorretos" | Use a senha do dispositivo (não a senha da conta do app da câmera). |
| Câmera "Conectando…" para sempre | Clique em Editar → Testar para ver o erro. Veja também se o Firewall bloqueou o ffmpeg. |
| Setas não giram | Editar → Avançado → mude a "Porta ONVIF" (tente 80, 8000, 8899 ou 5000). |
| Antivírus reclamou | Me diga qual arquivo e o nome da ameaça. O app só baixa o ffmpeg (gyan.dev) e o rclone (rclone.org). |

## Linux (opcional)

```
sudo apt install ffmpeg rclone nodejs npm
npm install && npm start
```

## Arquivos

- `src/server.js`: servidor web e API
- `src/presets.js`: modelos prontos por marca
- `src/discover.js`: procura câmeras na rede (ONVIF + porta 554)
- `src/probe.js`: testa a câmera e tira uma foto
- `src/recorder.js`: gravação contínua
- `src/live.js`: ao vivo (converte para H.264 enquanto alguém assiste)
- `src/drive.js`: Google Drive (conectar, enviar, limpar, assistir)
- `src/tools.js`: encontra/baixa o ffmpeg e o rclone
- `src/watcher.js`, `src/detector.js`: vigia as câmeras e detecta pessoas
- `src/events.js`, `src/push.js`: alertas (fotos) e notificações (Firebase)
- `public/`: o app (web/PWA)
- `data/app.json`: câmeras e ajustes salvos (criado sozinho)
