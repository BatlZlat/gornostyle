# Сервер `gornostyle72.ru` — инфраструктурная памятка

Последнее обновление: 2025‑11‑12 (MSK)  
Хост: `90.156.210.24` (Timeweb VPS)  
ОС: Ubuntu 24.04.1 LTS (kernel 6.8.0-52-generic)

## 1. Структура и доступ
- Основной пользователь: `root`.
- SSH:
  - Парольный доступ временно разрешён (`sshpass` используется для аварийного входа).
  - Локальные ключи лежат в `/root/.ssh/` (`id_rsa`, `id_ed25519`, файл `authorized_keys`).
  - Конфигурация SSH-клиента (`/root/.ssh/config`) содержит shortcut `gitea-server` и прямой доступ по IP с ключом `~/.ssh/id_rsa`.
  - `ufw` отключён (`Status: inactive`). Дополнительно рассматриваем ограничение доступа по IP при миграции.
- Каталоги:
  - Проект: `/root/project/gornostyle`
  - Бэкапы БД: `/root/gornostyle-backups/`

## 2. Приложение
- Node.js приложение (`src/app.js`) запускается под `pm2`.
  - Версия Node: 18.19.1 (фиксируется в `~/.pm2/dump.pm2`).
  - PM2-хранилище: `/root/.pm2/` (логи, pids, конфигурация `dump.pm2`).
  - Команда для ручного старта: `pm2 start src/app.js --name gornostyle`.
  - Автозапуск обеспечивается сервисом `pm2-root` (`/etc/systemd/system/pm2-root.service`), активен и включён.
- Основная точка входа HTTP-приложения: `http://127.0.0.1:8080`.
- Дополнительные зависимости (Puppeteer) тянут Chromium в `/root/.cache/puppeteer/...`.

## 3. Web-сервер (Nginx)
- Конфиг: `/etc/nginx/sites-enabled/gornostyle72.ru`.
  - HTTP → HTTPS редирект.
  - Проксирование на `http://127.0.0.1:8080`.
  - Логи: `/var/log/nginx/gornostyle-access.log`, `/var/log/nginx/gornostyle-error.log`.
  - SSL: Let’s Encrypt (`/etc/letsencrypt/live/gornostyle72.ru/`).
- Сервис `nginx` активен и в автозапуске (`systemctl status nginx`).

## 4. База данных и бэкапы
- Используется PostgreSQL (`DB_HOST=90.156.210.24`, база `skisimulator`, пользователь `batl-zlat`).
- Прямой доступ и пароли заданы:
  - В `.env` проекта (`/root/project/gornostyle/.env`).
  - В скрипте бэкапа `scripts/backup_database.sh` (содержит plaintext-пароль, требуется ревизия при миграции).
- Бэкап выполняется ежедневно в 02:00 MSK cron-задачей `0 2 * * * /root/scripts/backup_database.sh`. **Внимание:** фактический рабочий скрипт лежит в `/root/project/gornostyle/scripts/backup_database.sh`, поэтому путь в cron стоит обновить.
- Ручной запуск: `bash scripts/backup_database.sh`.
- Файл формируется как `skisimulator_YYYY-MM-DD_HH-MM-SS.sql.gz`, хранится в `/root/gornostyle-backups`, retention = 30 дней.
- Проверено: актуальный дамп (`skisimulator_2025-11-12_22-05-39.sql.gz`) содержит таблицы `kuliga_*` и прочие новые сущности.

## 5. Автоматизация и фоновые задачи
- `crontab -l`:
  - `0 3 * * * /usr/bin/certbot renew --quiet && systemctl reload nginx`
  - `0 2 * * * /root/scripts/backup_database.sh >> /root/gornostyle-backups/backup.log 2>&1` (фактический путь к скрипту — `/root/project/gornostyle/scripts/backup_database.sh`).
- Systemd:
  - `pm2-root.service` — управляет приложением.
  - `nginx.service` — reverse-proxy.
- Сертификация Let’s Encrypt продлевается автоматически через cron.

## 6. Файлы конфигурации проекта
- `.env`: хранит все секреты (PostgreSQL, Telegram, Tinkoff и т.д.). Для переноса: скопировать, либо подготовить шаблон без секретов.
- `ecosystem.config.js`: не используется текущим раскладом (процесс запускается напрямую через `pm2 start src/app.js`), но лежит в проекте.
- Документация по деплою: `DEPLOYMENT_INSTRUCTIONS.md`, `DEPLOYMENT_CHECKLIST.md`.

## 7. План миграции на новый сервер
1. **Подготовка окружения**
   - ОС: Ubuntu 22.04/24.04.
   - Установить Node.js 18.19.1 (через `nvm` или `NodeSource`).
   - Установить `pm2` глобально: `npm install -g pm2`.
   - Установить `nginx`, `certbot`, `postgresql-client`.
2. **Развёртывание проекта**
   - Скопировать репозиторий (через Git или rsync).
   - Перенести `.env` (актуализировать секреты и адрес БД, если будет меняться).
   - `npm ci` внутри `/root/project/gornostyle`.
   - Проверить `scripts/backup_database.sh` и обновить пути/пароли при необходимости.
3. **Настройка сервисов**
   - `pm2 start src/app.js --name gornostyle`.
   - `pm2 save`, `pm2 startup systemd` (или скопировать существующий `pm2-root.service`).
   - Настроить nginx-конфиг (`server_name`, SSL, proxy_pass).  
     Проверить `certbot` (`certbot --nginx -d gornostyle72.ru -d www.gornostyle72.ru`).
4. **Бэкапы и cron**
   - Создать директорию `/root/gornostyle-backups`.
   - Добавить cron-задание на бэкап и renewal Certbot (скорректировать путь к скрипту).
5. **Проверки**
   - Тестовые запросы к приложению (`curl -I https://gornostyle72.ru`).
   - Проверить логи `pm2 logs gornostyle`, `journalctl -u pm2-root`, `nginx`-логи.
   - Убедиться, что бэкап создаётся и содержит актуальные таблицы (`gunzip -c ... | head`).

## 8. Рекомендации по улучшению
- Обновить cron-задание на корректный путь к скрипту бэкапа.
- Рассмотреть включение `ufw` (разрешить 22/80/443) и ограничить SSH по IP.
- Перевести пароли из скриптов в `.env`/`pass` или секретный vault.
- Настроить оповещение при сбое бэкапа (например, через Telegram/Email).

---

Документ подготовлен для ускорения возможного переезда на новый сервер. При изменении конфигурации просьба дополнять актуальными данными (версии Node, расположение бэкапов, cron-задачи).


