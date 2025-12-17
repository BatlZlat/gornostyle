#!/bin/bash

# ============================================
# Установка электронной подписи на Ubuntu
# ============================================
# 
# Выполняйте команды по порядку, копируя их в терминал
# При запросе пароля введите ваш пароль sudo

echo "========================================="
echo "ШАГ 1: Обновление списка пакетов"
echo "========================================="
echo ""
echo "Выполните команду:"
echo "sudo apt update"
echo ""
read -p "Нажмите Enter после выполнения команды..."

echo ""
echo "========================================="
echo "ШАГ 2: Установка системных пакетов"
echo "========================================="
echo ""
echo "Выполните команду:"
echo "sudo apt install -y libccid pcscd pcsc-tools"
echo ""
echo "Примечание: libgost-astra доступен только для Astra Linux, в Ubuntu не требуется"
echo ""
read -p "Нажмите Enter после выполнения команды..."

echo ""
echo "========================================="
echo "ШАГ 3: Настройка сервиса pcscd"
echo "========================================="
echo ""
echo "Выполните команды:"
echo "sudo systemctl enable pcscd"
echo "sudo systemctl start pcscd"
echo "sudo systemctl status pcscd"
echo ""
read -p "Нажмите Enter после выполнения команд..."

echo ""
echo "========================================="
echo "ШАГ 4: Проверка установки"
echo "========================================="
echo ""
echo "Проверьте, что сервис pcscd активен:"
echo "systemctl is-active pcscd"
echo ""
echo "Проверьте наличие утилиты pcsc_scan:"
echo "which pcsc_scan"
echo ""
read -p "Нажмите Enter после проверки..."

echo ""
echo "========================================="
echo "✅ Системные пакеты установлены!"
echo "========================================="
echo ""
echo "Следующие шаги:"
echo "1. Скачайте КриптоПро CSP с сайта: https://www.cryptopro.ru/products/csp/downloads"
echo "2. Распакуйте архив: tar zxvf linux-amd64_deb.tgz"
echo "3. Запустите установщик: cd linux-amd64_deb && sudo ./install_gui.sh"
echo ""
echo "Подробные инструкции в файле: INSTALL_ELECTRONIC_SIGNATURE.md"

