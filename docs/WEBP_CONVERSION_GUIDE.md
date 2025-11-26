# Руководство по конвертации изображений в WebP

## Скрипт для конвертации

Создан скрипт `scripts/convert-to-webp.sh` для автоматической конвертации изображений в формат WebP.

## Установка зависимостей

### Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install webp
```

### macOS:
```bash
brew install webp
```

## Использование

### Конвертация одного файла:
```bash
./scripts/convert-to-webp.sh path/to/image.jpg
```

### Конвертация всех изображений в папке:
```bash
./scripts/convert-to-webp.sh path/to/images/
```

## Примеры

```bash
# Конвертация одного изображения
./scripts/convert-to-webp.sh uploads/new-hero-bg.jpg

# Конвертация всех изображений в папке
./scripts/convert-to-webp.sh uploads/kuliga-photos/

# Результат: создастся файл new-hero-bg.webp рядом с оригиналом
```

## Рекомендации

1. **Всегда конвертируйте в webp перед загрузкой** в проект
2. **Качество**: Скрипт использует качество 85 (хороший баланс размер/качество)
3. **Проверка**: Скрипт автоматически пропускает уже существующие webp файлы
4. **Размер**: WebP обычно на 25-35% меньше чем JPEG/PNG при том же качестве

## Для подложки hero (шапка)

1. Подготовьте изображение (рекомендуемый размер: 1920x1080 или больше)
2. Конвертируйте в webp:
   ```bash
   ./scripts/convert-to-webp.sh path/to/hero-image.jpg
   ```
3. Загрузите в `/public/images/kuliga/kuliga-hero-bg.webp`
4. Обновите CSS: `public/css/kuliga.css` (строка 81)

