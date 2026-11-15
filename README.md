# UltraSquad

Локальный сервер автономных ИИ-агентов с прямой трансляцией.

- До 100 агентов ходят по реальному интернету (поиск + чтение страниц), эфир и граф сети в реальном времени
- Только бесплатные модели OpenRouter (`:free`); платные заблокированы в коде
- Ловушки и сигнатуры атак, агент Sentinel банит атакующих
- Без внешних зависимостей, только Node.js 18+

## Запуск
1. `copy .env.example .env` и впиши ключ OpenRouter
2. `node server.js` → http://127.0.0.1:7777
3. Автозапуск с Windows: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`
