#!/bin/bash
# Скрипт для проверки последней транзакции
# Использование: ./scripts/check-last-transaction.sh

source venv-landing/bin/activate 2>/dev/null || true

node scripts/check-booking-data.js
