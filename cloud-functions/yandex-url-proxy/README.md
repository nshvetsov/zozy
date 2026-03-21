# Yandex Cloud Function: URL HTML Proxy

Эта функция нужна для production-режима, где браузер не может стабильно читать внешние URL из-за CORS.

## Что делает

- Принимает `POST` JSON: `{ "url": "https://..." }`
- Загружает HTML на сервере
- Возвращает HTML в ответе + CORS-заголовки

## Деплой

1. Создайте Cloud Function (runtime: Node.js 20).
2. Загрузите `index.js` как код функции (рекомендуется для совместимости).
3. Точка входа: `index.handler`.
4. (Опционально) задайте env `ALLOWED_HOSTS`, например:
   - `oriflame.mindbox.ru,example.com`
5. Сделайте HTTP-триггер для функции.

Если видите ошибку `Cannot find module '/function/code/index.js'`, значит рантайм ищет CommonJS-модуль `index.js`. Убедитесь, что файл называется именно `index.js`, а entrypoint — `index.handler`.

## Проверка

```bash
curl -X POST "https://functions.yandexcloud.net/<FUNCTION_ID>" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com\"}"
```

## Подключение в приложении

В UI сервиса укажите endpoint в поле:

- `URL proxy endpoint (Yandex Cloud Function, опционально)`

Например: `https://functions.yandexcloud.net/<FUNCTION_ID>`
