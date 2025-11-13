# Сервер `gornostyle72.ru` — инфраструктурная памятка

Последнее обновление: 2025‑11‑13 (MSK)  
Хост: `5.129.248.187` (Timeweb VPS, зона NSK-1)  
ОС: Ubuntu 24.04.3 LTS (kernel 6.8.0-87-generic)

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
- Используется PostgreSQL 16, установлен локально (`DB_HOST=127.0.0.1`, база `skisimulator`, пользователь `batl-zlat`).
- Учётные данные лежат в `.env` (не коммитим); для служебных задач пароль экспортируется в `scripts/backup_database.sh`.
- Скрипт `scripts/backup_database.sh` создаёт архив `skisimulator_YYYY-MM-DD_HH-MM-SS.sql.gz` в `/root/gornostyle-backups`, хранение 30 дней (очистка через `find` внутри скрипта).
- Дополнительный скрипт `scripts/upload_backup_to_yadisk.sh` копирует последний архив на Яндекс.Диск (`yadisk:gornostyle-backups`) и удаляет в облаке файлы старше 10 дней.
- Для аварийного восстановления используется `pg_restore`/`psql` с локального дампа или дампа из облака (см. ниже).

- `cron` (`/etc/cron.d/gornostyle-backups`):
  - `0 2 * * * root /root/project/gornostyle/scripts/backup_database.sh >> /root/gornostyle-backups/backup.log 2>&1`
  - `30 2 * * * root /root/project/gornostyle/scripts/upload_backup_to_yadisk.sh >> /root/gornostyle-backups/backup.log 2>&1`
  - `0 3 * * * root /usr/bin/certbot renew --quiet && systemctl reload nginx`
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
- Секреты (`DB_PASSWORD`, OAuth токен Яндекс.Диска) вынести в vault или отдельные конфигурационные файлы с ограниченным доступом.
- Рассмотреть включение `ufw` (разрешить 22/80/443) и ограничить SSH по IP.
- Настроить оповещение при сбое бэкапа (например, через Telegram/Email).

---

Документ подготовлен для ускорения возможного переезда на новый сервер. При изменении конфигурации просьба дополнять актуальными данными (версии Node, расположение бэкапов, cron-задачи).


