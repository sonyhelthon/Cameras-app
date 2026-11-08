# Minhas Câmeras: sem nuvem paga

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

## Usar no celular

- **Em casa (mesmo Wi-Fi):** abra no Chrome o endereço que aparece na janela do `iniciar.bat` (ex.: `http://192.168.100.47:8080`).
- **Instalar como app:** no Chrome, **⋮ → Adicionar à tela inicial**.
- **Fora de casa (grátis e seguro):** instale o **Tailscale** (tailscale.com) no computador servidor e no celular, com a mesma conta. Use o endereço `100.x.x.x` que o Tailscale mostra. **Não abra portas no roteador.**
- **Duas centrais (casa e igreja):** com o Tailscale nos dois computadores, salve os dois endereços na tela inicial (um ícone para cada local).

---

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
- `public/`: o app (web/PWA)
- `data/app.json`: câmeras e ajustes salvos (criado sozinho)
