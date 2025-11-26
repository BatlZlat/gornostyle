#!/bin/bash

# Скрипт для конвертации изображений в формат WebP
# Использование: ./scripts/convert-to-webp.sh <путь_к_файлу_или_папке>

# Проверка наличия cwebp (ImageMagick или libwebp)
if ! command -v cwebp &> /dev/null; then
    echo "❌ cwebp не найден. Установите libwebp:"
    echo "   Ubuntu/Debian: sudo apt-get install webp"
    echo "   macOS: brew install webp"
    exit 1
fi

# Функция для конвертации одного файла
convert_file() {
    local input_file="$1"
    local output_file="${input_file%.*}.webp"
    
    # Пропускаем уже webp файлы
    if [[ "$input_file" == *.webp ]]; then
        echo "⏭️  Пропущен (уже webp): $input_file"
        return
    fi
    
    # Пропускаем если webp уже существует
    if [[ -f "$output_file" ]]; then
        echo "⏭️  Пропущен (webp уже существует): $output_file"
        return
    fi
    
    echo "🔄 Конвертация: $input_file -> $output_file"
    
    # Конвертация с качеством 85 (хороший баланс размер/качество)
    cwebp -q 85 "$input_file" -o "$output_file"
    
    if [ $? -eq 0 ]; then
        echo "✅ Успешно: $output_file"
        
        # Показываем размеры
        original_size=$(stat -f%z "$input_file" 2>/dev/null || stat -c%s "$input_file" 2>/dev/null)
        new_size=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null)
        if [ -n "$original_size" ] && [ -n "$new_size" ]; then
            savings=$(echo "scale=1; (1 - $new_size / $original_size) * 100" | bc)
            echo "   Размер: $(numfmt --to=iec-i --suffix=B $original_size 2>/dev/null || echo "${original_size}B") -> $(numfmt --to=iec-i --suffix=B $new_size 2>/dev/null || echo "${new_size}B") (экономия ~${savings}%)"
        fi
    else
        echo "❌ Ошибка при конвертации: $input_file"
    fi
}

# Обработка аргументов
if [ $# -eq 0 ]; then
    echo "Использование: $0 <файл_или_папка>"
    echo "Примеры:"
    echo "  $0 image.jpg"
    echo "  $0 /path/to/images/"
    exit 1
fi

input_path="$1"

if [ -f "$input_path" ]; then
    # Один файл
    convert_file "$input_path"
elif [ -d "$input_path" ]; then
    # Папка - конвертируем все изображения
    echo "📁 Обработка папки: $input_path"
    find "$input_path" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) | while read -r file; do
        convert_file "$file"
    done
    echo "✅ Конвертация завершена"
else
    echo "❌ Файл или папка не найдены: $input_path"
    exit 1
fi

