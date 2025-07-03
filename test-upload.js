const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

async function testUpload() {
    try {
        // Создаем тестовое изображение
        const testImagePath = 'test-image.jpg';
        
        // Проверяем, есть ли тестовое изображение
        if (!fs.existsSync(testImagePath)) {
            console.log('❌ Тестовое изображение не найдено. Создайте файл test-image.jpg');
            return;
        }

        const form = new FormData();
        form.append('photo', fs.createReadStream(testImagePath));

        console.log('🔄 Тестируем загрузку фотографии...');

        const response = await axios.post('http://localhost:8080/api/trainers/2/upload-photo', form, {
            headers: {
                ...form.getHeaders(),
            },
            timeout: 10000
        });

        console.log('✅ Ответ сервера:', response.data);
        
        // Проверяем, создался ли файл
        const files = fs.readdirSync('public/images/trainers');
        console.log('📁 Файлы в папке trainers:', files);

    } catch (error) {
        console.error('❌ Ошибка:', error.response?.data || error.message);
    }
}

testUpload(); 