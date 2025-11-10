'use strict';

(function () {
    const API = {
        groupTrainings: '/api/kuliga/group-trainings',
        createBooking: '/api/kuliga/bookings',
    };

    const form = document.getElementById('kuligaBookingForm');
    const select = document.getElementById('kuligaGroupSelect');
    const participantsCountInput = document.getElementById('kuligaParticipantsCount');
    const participantsList = document.getElementById('kuligaParticipantsList');
    const totalPriceLabel = document.getElementById('kuligaTotalPrice');
    const messageBox = document.getElementById('kuligaBookingMessage');

    let groupData = [];

    const formatDate = (dateString) => {
        const date = new Date(dateString + 'T00:00:00');
        return new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
            weekday: 'long',
        }).format(date);
    };

    const formatTime = (timeString) => {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
    };

    const renderGroupOptions = (items) => {
        select.innerHTML = '';

        if (!items.length) {
            const option = document.createElement('option');
            option.value = '';
            option.disabled = true;
            option.selected = true;
            option.textContent = 'Нет доступных групп. Напишите администратору';
            select.appendChild(option);
            select.disabled = true;
            return;
        }

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        defaultOption.textContent = 'Выберите удобное занятие';
        select.appendChild(defaultOption);

        items.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            const dateLabel = formatDate(item.date);
            const timeStart = formatTime(item.start_time);
            const label = `${dateLabel}, ${timeStart} — ${item.level} (${item.current_participants}/${item.max_participants})`;
            option.textContent = label;
            option.dataset.price = item.price_per_person;
            option.dataset.max = item.max_participants;
            option.dataset.current = item.current_participants;
            select.appendChild(option);
        });
    };

    const updateParticipantsFields = () => {
        participantsList.innerHTML = '';
        const count = Number(participantsCountInput.value) || 1;

        for (let index = 0; index < count; index += 1) {
            const wrapper = document.createElement('div');
            wrapper.className = 'kuliga-participant-input';
            wrapper.innerHTML = `
                <label>Имя участника ${index + 1}${index === 0 ? ' (основной)' : ''}</label>
                <input type="text" name="participantName${index}" maxlength="60" placeholder="Имя участника" ${index === 0 ? 'readonly value="" data-main-participant' : ''}>
            `;
            participantsList.appendChild(wrapper);
        }

        const mainInput = participantsList.querySelector('[data-main-participant]');
        if (mainInput && form.fullName) {
            const sync = () => {
                mainInput.value = form.fullName.value.trim();
            };
            sync();
            form.fullName.addEventListener('input', sync);
        }
    };

    const updateSummary = () => {
        const selectedOption = select.options[select.selectedIndex];
        const count = Number(participantsCountInput.value) || 1;

        if (!selectedOption || !selectedOption.value) {
            totalPriceLabel.textContent = '—';
            return;
        }

        const price = Number(selectedOption.dataset.price || 0);
        const total = price * count;
        totalPriceLabel.textContent = `${total.toLocaleString('ru-RU')} ₽`;
    };

    const normalizePhone = (value) => value.replace(/[^0-9+]/g, '');

    const getParticipantsNames = (count) => {
        const names = [];
        for (let index = 0; index < count; index += 1) {
            const input = form[`participantName${index}`];
            if (input) {
                const trimmed = input.value.trim();
                if (trimmed) {
                    names.push(trimmed);
                }
            }
        }
        return names;
    };

    const showMessage = (text, type = 'neutral') => {
        messageBox.textContent = text;
        messageBox.className = `kuliga-message${type === 'error' ? ' kuliga-message--error' : ''}${type === 'success' ? ' kuliga-message--success' : ''}`;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        showMessage('Отправляем данные...', 'neutral');

        if (!form.checkValidity()) {
            form.reportValidity();
            showMessage('Проверьте корректность заполнения формы', 'error');
            return;
        }

        const { fullName, phone, email, bookingType, groupTrainingId, consentConfirmed } = form;
        if (!consentConfirmed.checked) {
            showMessage('Нужно подтвердить согласие на обработку персональных данных', 'error');
            return;
        }

        const selectedOption = groupTrainingId.options[groupTrainingId.selectedIndex];
        if (!selectedOption || !selectedOption.value) {
            showMessage('Выберите групповое занятие', 'error');
            return;
        }

        const participantsCount = Math.max(1, Math.min(4, Number(participantsCountInput.value) || 1));
        const participantsNames = getParticipantsNames(participantsCount);

        const payload = {
            fullName: fullName.value.trim(),
            phone: normalizePhone(phone.value),
            email: email.value.trim(),
            bookingType: bookingType.value,
            groupTrainingId: selectedOption.value,
            participantsCount,
            participantsNames,
            consentConfirmed: consentConfirmed.checked,
        };

        try {
            const response = await fetch(API.createBooking, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось создать бронирование');
            }

            showMessage('Перенаправляем на страницу оплаты...', 'success');
            if (data.paymentUrl) {
                window.location.href = data.paymentUrl;
            }
        } catch (error) {
            console.error('Ошибка бронирования Кулиги:', error);
            showMessage(error.message || 'Произошла ошибка, попробуйте позже', 'error');
        }
    };

    const loadGroupTrainings = async () => {
        try {
            const response = await fetch(API.groupTrainings, { headers: { 'Accept': 'application/json' } });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error('Не удалось получить список занятий');
            }
            groupData = data.data || [];
            renderGroupOptions(groupData);
        } catch (error) {
            console.error(error);
            select.innerHTML = '<option value="" disabled selected>Не удалось загрузить занятия</option>';
            select.disabled = true;
            showMessage('Не удалось загрузить список занятий. Попробуйте обновить страницу.', 'error');
        } finally {
            updateSummary();
        }
    };

    if (form) {
        loadGroupTrainings();
        updateParticipantsFields();

        form.addEventListener('submit', handleSubmit);
        select.addEventListener('change', updateSummary);
        participantsCountInput.addEventListener('change', () => {
            const selectedOption = select.options[select.selectedIndex];
            const max = selectedOption ? Number(selectedOption.dataset.max || 4) : 4;
            const current = selectedOption ? Number(selectedOption.dataset.current || 0) : 0;
            const value = Number(participantsCountInput.value) || 1;

            if (value < 1) {
                participantsCountInput.value = 1;
            } else if (value > 4) {
                participantsCountInput.value = 4;
            }

            if (value + current > max) {
                const allowed = Math.max(1, max - current);
                participantsCountInput.value = allowed;
                showMessage(`Свободных мест осталось: ${allowed}. Скорректировали количество участников.`, 'error');
            } else {
                showMessage('');
            }

            updateParticipantsFields();
            updateSummary();
        });

        form.fullName.addEventListener('input', () => {
            const mainInput = participantsList.querySelector('[data-main-participant]');
            if (mainInput) {
                mainInput.value = form.fullName.value.trim();
            }
        });
    }
})();
