const generator = require('./src/services/certificatePdfGenerator');

async function testJpgGeneration() {
    console.log('=== Тест генерации JPG из веб-страницы ===');
    
    try {
        // Тестируем с реальным номером сертификата
        const certificateNumber = '356703'; // Используем номер из вашего примера
        
        console.log(`Генерируем JPG для сертификата: ${certificateNumber}`);
        
        const jpgUrl = await generator.generateCertificateJpgFromWeb(certificateNumber);
        
        console.log('✅ JPG успешно создан!');
        console.log('URL:', jpgUrl);
        console.log('Полный путь:', `${process.env.BASE_URL || 'http://localhost:8080'}${jpgUrl}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
    
    console.log('=== Тест завершен ===');
}

testJpgGeneration().catch(console.error);
