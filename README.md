# UltraSquad

Локальный сервер автономных ИИ-агентов — охотников за киберугрозами, с прямой трансляцией.

- До **1000 агентов** ходят по реальному интернету; эфир (видео), граф сети и чат отряда в реальном времени
- **Реальная разведка угроз:** агенты подтягивают настоящие активно эксплуатируемые уязвимости из **CISA KEV** и свежие **CVE из NVD** (не имитация), камера показывает реальную страницу уязвимости
- **Команды и режимы:** красные (Agent01…) блокируют вирусные серверы (C2) и сбежавших агентов, синие караулят; при атаке **все переходят в оборону**, при шквале — **боевой режим** (блок подсетей, бессрочные баны; без hack-back)
- **Превентивная защита:** ~27k реальных вредоносных IP/подсетей (abuse.ch, blocklist.de, FireHOL) блокируются до атаки
- **Оборона своего сервера:** ловушки, сигнатуры (SQLi/XSS/RCE/Log4Shell/сканеры), авто-бан, щит, **карантин**, **мобилизация** и учения «красные против синих»
- Мозг: бесплатные модели OpenRouter (`:free`, по умолчанию) · Ollama · Claude; платные заблокированы в коде
- Без внешних зависимостей, только Node.js 18+

## Запуск
1. `copy .env.example .env` и впиши ключ OpenRouter (Ollama по желанию)
2. `node server.js` → http://127.0.0.1:7777
3. Автозапуск с Windows: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`

## Управление из приложения Claude (MCP)

`mcp/ultrasquad-mcp.mjs` — MCP-сервер: Claude Desktop подключает его как инструмент, и ты прямо в чате говоришь «покажи угрозы», «мобилизуй отряд», «поставь задачу». Работает, пока запущен UltraSquad на этом же компьютере.

Добавь в `claude_desktop_config.json` (Claude → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "ultrasquad": {
      "command": "node",
      "args": ["C:\\Users\\Solo Developer\\UltraSquad\\mcp\\ultrasquad-mcp.mjs"]
    }
  }
}
```

Перезапусти Claude Desktop. Инструменты: `ultrasquad_status`, `ultrasquad_threats`, `ultrasquad_mobilize`, `ultrasquad_lockdown`, `ultrasquad_patrol`, `ultrasquad_spawn`, `ultrasquad_task`, `ultrasquad_pause`, `ultrasquad_resume`. Управление с телефона (мобильный Claude) заработает только если поднять UltraSquad на облачном сервере с публичным адресом и указать его в `ULTRASQUAD_URL`.

## Защита на Windows

Запуск: `node server.js`. Панель защиты: http://127.0.0.1:7777/#security.
Sentinel обновляет состояние Microsoft Defender каждые 30 секунд и сообщает в чат об изменениях.
«Быстрая проверка» запускает штатное сканирование Windows, если права пользователя позволяют.
Историю обнаружений и действия с угрозами можно посмотреть в «Безопасности Windows».
Патруль и блокировка подозрительных входящих запросов работают без ключей и модели.

Vercel публикует интерфейс из `public`. Панель с данными, камера и агент Windows работают через локальный сервер.

## Сервер на Android

Установи [Termux](https://github.com/termux/termux-app#installation), затем выполни:

```sh
pkg update
pkg install git nodejs-lts
git clone https://github.com/GX85/UltraSquad-.git ultrasquad
cd ultrasquad
node server.js
```

Открой http://127.0.0.1:7777/#live в браузере на этом же телефоне.
Для работы сервера оставь Termux запущенным. На Android доступны чат, цели и журнал запросов этого сервера.
Microsoft Defender и камера Edge работают только в Windows.

## Вход на публичном сайте

UltraSquad подключается напрямую к Google и GitHub через OAuth.
Зарегистрируй веб-клиент Google и OAuth App на GitHub. Укажи соответствующий адрес возврата:

- Google: `https://ultrasquad.vercel.app/api/auth?action=callback&provider=google`
- GitHub: `https://ultrasquad.vercel.app/api/auth?action=callback&provider=github`

Добавь в настройки Production на Vercel `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` и отдельный случайный `AUTH_SESSION_SECRET`
размером не менее 32 байт. После изменения переменных переопубликуй сайт.
Можно начать с одного провайдера: сайт покажет только настроенные кнопки.
Секреты остаются в Vercel. Вход на Vercel не открывает управление локальным сервером из интернета.
