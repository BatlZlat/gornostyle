document.addEventListener('DOMContentLoaded', function() {
    const paymentLinkForm = document.getElementById('payment-link-form');
    const paymentLinkResult = document.getElementById('payment-link-result');
    const paymentLinkInput = document.getElementById('payment-link');

    if (paymentLinkForm) {
        paymentLinkForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = {
                amount: document.getElementById('payment-amount').value,
                description: document.getElementById('payment-description').value,
                expires_in: document.getElementById('payment-expires').value
            };

            try {
                const response = await fetch('/api/payment-links', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    const data = await response.json();
                    paymentLinkInput.value = data.payment_link;
                    paymentLinkResult.style.display = 'block';
                } else {
                    throw new Error('Ошибка при создании ссылки на оплату');
                }
            } catch (error) {
                console.error('Ошибка при создании ссылки на оплату:', error);
                showError('Не удалось создать ссылку на оплату');
            }
        });
    }

    // Функция копирования ссылки в буфер обмена
    window.copyPaymentLink = function() {
        paymentLinkInput.select();
        document.execCommand('copy');
        showSuccess('Ссылка скопирована в буфер обмена');
    };

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }

    // Функция отображения успешных сообщений
    function showSuccess(message) {
        // Здесь можно добавить код для отображения успешных сообщений
        console.log(message);
    }
}); 