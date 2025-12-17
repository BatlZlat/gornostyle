# Установка Chromium GOST для работы с электронной подписью

## Проблема

- Firefox 146.0 не поддерживает NPAPI плагины (поддержка прекращена с версии 52+)
- Плагин КриптоПро - это NPAPI плагин
- Поэтому Firefox не видит плагин КриптоПро

## Решение: Chromium GOST

Chromium GOST - специальная сборка браузера Chromium с поддержкой:
- Электронной подписи (ЭП)
- Российских криптографических алгоритмов ГОСТ
- Плагина КриптоПро

---

## Способы установки

### Способ 1: Скачать с сайта КриптоПро

1. Перейдите на сайт: https://www.cryptopro.ru/products/browsers/chromium-gost
2. Скачайте версию для Linux (DEB для Ubuntu/Debian)
3. Установите:
   ```bash
   sudo dpkg -i chromium-gost*.deb
   sudo apt-get install -f  # если есть зависимости
   ```

### Способ 2: Установка из репозитория (если доступен)

```bash
# Добавить репозиторий (если есть)
# Установить
sudo apt update
sudo apt install chromium-gost
```

---

## После установки

1. Запустите Chromium GOST
2. Плагин КриптоПро должен работать автоматически
3. Вставьте токен Рутокен
4. Откройте сайт госуслуг
5. Нажмите "Войти с помощью ЭП"
6. Браузер должен предложить выбрать сертификат

---

## Альтернатива: Расширение для Chrome

Есть расширение КриптоПро для Chrome:
- https://chrome.google.com/webstore/detail/cryptopro-extension-for-c/iifchhfnnmpdbibifmljnfjhpififfog

**НО:** Обычный Chrome тоже не поддерживает NPAPI, поэтому расширение может не работать. Лучше использовать Chromium GOST.

---

## Полезные ссылки

- [Сайт КриптоПро - Chromium GOST](https://www.cryptopro.ru/products/browsers/chromium-gost)
- [Документация по установке](https://www.cryptopro.ru/sites/default/files/products/cades/plugin_linux.html)

---

## Итог

**Рекомендуется установить Chromium GOST** - это самый надежный способ для работы с электронной подписью на Linux.

