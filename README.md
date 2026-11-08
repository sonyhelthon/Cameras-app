# Minhas Câmeras: sem nuvem paga

App próprio para as câmeras Wi-Fi **Jortan JT-8177** (app Yoosee), ou qualquer câmera com RTSP/ONVIF.

- **Ao vivo:** as 4 câmeras na tela, ou uma em tela cheia com opção de HD e som.
- **Girar a câmera** (setas) pelo ONVIF.
- **Gravação 24 horas** no notebook, em arquivos de 10 minutos.
- **Backup automático no Google Drive.** Apaga do Drive depois de X dias e libera o notebook só depois de enviar.
- **Gravações:** escolha câmera e dia e assista. O que está no notebook ou no Drive toca direto no app.
- **Web e Android:** abra no navegador ou instale como app (PWA). Tem login com senha.

```
4 câmeras ──RTSP──▶ notebook (este programa + ffmpeg) ──rclone──▶ Google Drive
                         │
                         └──▶ navegador / app Android (em casa ou por Tailscale fora dela)
```

## Espaço e internet

| Configuração | Por câmera/dia | 4 câmeras/dia | 5 TB duram |
|---|---|---|---|
| `stream: main` (1080p) | ~20 GB | ~80 GB | ~55 a 60 dias |
| `stream: sub` (qualidade menor) | ~3 a 5 GB | ~15 GB | ~1 ano |

**Upload:** para enviar 1080p das 4 câmeras, a internet precisa de **pelo menos 10 Mbps de upload** sem parar. Teste em fast.com (clique em "Mais informações"). Se o upload for menor, use `stream: sub`.

O padrão é guardar **45 dias** no Drive (`drive.retentionDays`).

---

## Instalação no notebook (Windows)

### 1. Programas (uma vez só)

1. **Node.js LTS:** baixe em nodejs.org e instale.
2. **ffmpeg:** baixe em gyan.dev/ffmpeg/builds ("ffmpeg-release-essentials.zip"). Extraia e copie o `ffmpeg.exe` da pasta `bin` para `C:\cameras\bin\`.
3. **rclone:** baixe em rclone.org/downloads (Windows 64 bits). Extraia e copie o `rclone.exe` para `C:\cameras\bin\`.
4. Copie esta pasta `cameras` para `C:\cameras\app\`. Abra o **Prompt de Comando** nela e rode:
   ```
   npm install
   ```

### 2. Ligar o Google Drive (uma vez só)

No Prompt de Comando:
```
C:\cameras\bin\rclone.exe config
```
- `n` (novo remote), nome: **gdrive**
- Storage: digite **drive**
- client_id e client_secret: deixe em branco (Enter)
- scope: **1** (acesso completo)
- Nas outras perguntas, aperte Enter até "Use web browser to automatically authenticate?" e responda **y**. O navegador abre para você entrar na conta do Google de 5 TB.
- "Configure this as a Shared Drive?": **n**. Depois **y** para confirmar e **q** para sair.

Teste com `C:\cameras\bin\rclone.exe lsd gdrive:`. Ele deve listar as pastas do seu Drive.

### 3. Preparar as câmeras

Para cada câmera, no app **Yoosee**:
1. Defina uma **senha do dispositivo** (Configurações → Segurança).
2. Descubra o **IP** (no app em "Rede", ou na lista de aparelhos do roteador).
3. No roteador, **reserve o IP** de cada câmera (DHCP estático), para não mudar.

Teste uma no **VLC** (Mídia → Abrir fluxo de rede):
```
rtsp://admin:SENHA@192.168.100.42:554/onvif1
```

### 4. Configurar

Copie `config.example.yaml` para `config.yaml` e preencha:
- `server.password`: a senha para entrar no app
- `bin.ffmpeg: C:/cameras/bin/ffmpeg.exe` e `bin.rclone: C:/cameras/bin/rclone.exe`
- `cameras`: nome, IP e senha de cada câmera

### 5. Rodar

Dê dois cliques em **`iniciar.bat`**. A janela mostra o endereço, algo como `http://192.168.0.50:8080`.

- **No notebook:** abra `http://localhost:8080`
- **No celular, no mesmo Wi-Fi:** abra `http://IP-DO-NOTEBOOK:8080` no Chrome

### 6. O notebook não pode dormir

- Configurações → Sistema → Energia: **Tela e suspensão → "Nunca"** (na tomada).
- Painel de Controle → Opções de Energia → "Escolher a função de fechar a tampa": **"Nada a fazer"** (na tomada).
- Para iniciar sozinho quando o Windows ligar: aperte `Win+R`, digite `shell:startup` e coloque ali um **atalho** do `iniciar.bat`. Também ative o login automático no Windows, ou use o Agendador de Tarefas com "Executar estando o usuário conectado ou não".

---

## Usar fora de casa (grátis e seguro): Tailscale

**Não abra portas no roteador.** Use o Tailscale:
1. Instale o Tailscale (tailscale.com) **no notebook** e **no celular**, com a mesma conta.
2. No celular, abra `http://NOME-DO-NOTEBOOK:8080` ou o IP `100.x.x.x` que o Tailscale mostra.

Funciona no 4G como se você estivesse em casa.

## Instalar como app no Android

No Chrome do celular, abra o endereço, toque nos **⋮ → "Adicionar à tela inicial" / "Instalar app"**. Vai aparecer o ícone "Câmeras".

> Observação: o Android só oferece "Instalar app" completo em endereços HTTPS. Por `http://`, ele cria um atalho que também funciona. Para ter HTTPS, rode no notebook `tailscale serve --bg 8080` e use o endereço `https://NOME.SEU-TAILNET.ts.net` que ele mostrar.

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Câmera "Conectando…" para sempre | Confira IP e senha. Teste no VLC. Algumas versões usam `/live/ch00_0` em vez de `/onvif1`: use `main:` e `sub:` com a URL completa no config. |
| Imagem trava | Wi-Fi fraco na câmera. Aproxime o roteador ou use um repetidor. Abra o ao vivo sem HD. |
| Setas não giram | A porta ONVIF dessa câmera pode ser outra (`onvifPort`: tente 80 ou 8899). |
| "Drive: erro no envio" | Rode `rclone lsd gdrive:` para testar o login. Se pedir, rode `rclone config reconnect gdrive:`. |
| Ponto vermelho apagado | Essa câmera não está gravando. Passe o mouse ou segure o dedo no ponto para ver o motivo. |

## Rodar no Linux (opcional)

```
sudo apt install ffmpeg rclone nodejs npm
npm install
cp config.example.yaml config.yaml   # edite
npm start
```

## Arquivos

- `src/server.js`: servidor web e API
- `src/recorder.js`: gravação contínua (ffmpeg, arquivos de 10 min)
- `src/live.js`: vídeo ao vivo (HLS sob demanda; só conecta enquanto alguém está vendo)
- `src/drive.js`: envio ao Google Drive, limpeza e reprodução do Drive
- `src/ptz.js`: girar câmera (ONVIF)
- `public/`: o app (web/PWA)
