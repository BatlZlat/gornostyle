const generator = require('./src/services/certificatePdfGenerator');

async function testJpgGenerationOnly() {
    console.log('=== Тест только генерации JPG ===');
    
    try {
        // Тестируем с реальным номером сертификата
        const certificateNumber = '356703';
        
        console.log(`Генерируем JPG для сертификата: ${certificateNumber}`);
        
        const result = await generator.generateCertificateJpgForEmail(certificateNumber);
        
        console.log('✅ JPG успешно создан!');
        console.log('Результат:', result);
        
        if (result.jpg_url) {
            console.log('JPG URL:', result.jpg_url);
            console.log('Полный путь:', `${process.env.BASE_URL || 'http://localhost:8080'}${result.jpg_url}`);
        } else if (result.pdf_url) {
            console.log('Fallback PDF URL:', result.pdf_url);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
    
    console.log('=== Тест завершен ===');
}

testJpgGenerationOnly().catch(console.error);
