# Sala Control

MVP de aplicativo para controlar uma sala com data show, ar-condicionado, som, luzes e tela de projecao.

Nesta primeira versao, os comandos sao simulados em uma API local. A estrutura ja esta pronta para trocar a simulacao por integracoes reais com BroadLink, ESP32, rele, IR, RS-232 ou comandos por rede.

## Como rodar

```powershell
npm start
```

Depois abra no computador:

```txt
http://127.0.0.1:5184
```

## Versao publicada

GitHub Pages:

```txt
https://owagnerjrr.github.io/aplicativo/
```

No GitHub Pages o app roda em modo demo, sem o servidor local. As cenas e os botoes funcionam visualmente, mas nao enviam comandos reais para equipamentos.

## Como testar no celular

O celular e o computador precisam estar no mesmo Wi-Fi.

1. No computador, descubra o IP local:

```powershell
ipconfig
```

2. Procure o `Endereco IPv4`, por exemplo:

```txt
192.168.0.25
```

3. Com o servidor rodando, abra no navegador do celular:

```txt
http://192.168.0.25:5184
```

Se nao abrir, permita o Node.js no Firewall do Windows para redes privadas.

## Endpoints principais

Ver estado atual:

```txt
GET /api/state
```

Executar cenas:

```txt
POST /api/scene/presentation
POST /api/scene/meeting
POST /api/scene/focus
POST /api/scene/shutdown
```

Alterar um dispositivo:

```txt
POST /api/device/projector
POST /api/device/ac
POST /api/device/audio
POST /api/device/lights
POST /api/device/screen
```

Exemplo de corpo JSON:

```json
{
  "power": true
}
```
